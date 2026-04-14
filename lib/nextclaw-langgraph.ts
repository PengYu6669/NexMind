import { Prisma } from "@prisma/client";
import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ragSearch, stripHtmlToText } from "@/lib/rag";
import { buildKbDigestFromRelated } from "@/lib/nextclaw-kb-digest";
import { auditorAgent, plannerAgent, coachAgent, retrieverAgent, roleLabel } from "@/lib/nextclaw-multi-agent";
import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";
import { executeTool } from "@/lib/nextclaw-agent-tools";
import { decideNeedWebSearch, pickBestFromWebResults } from "@/lib/nextclaw-autonomous-loop";
import { policyOf } from "@/lib/nextclaw-orchestrator-policy";
import {
  createExecutionMetrics,
  markToolFailureEffect,
  shouldRetryTool,
  toEvaluationSummary,
} from "@/lib/nextclaw-workflow-policy";
import { RAG_TOPK_DEEP, RAG_TOPK_LITE } from "@/lib/nextclaw-agent-config";
import type { PlanToolName } from "@/lib/nextclaw-agent-types";

type JobType = "NOTE_LEARN_LITE" | "NOTE_LEARN_DEEP";

type RelatedNote = { noteId: string; title: string; snippet: string; distance?: number };

export type NextClawLangGraphState = {
  jobId: string;
  userId: string;
  noteId: string;
  jobType: JobType;

  noteTitle: string | undefined;
  noteHtml: string | undefined;
  noteText: string | undefined;

  relatedNotes: RelatedNote[] | undefined;
  relatedLines: string[] | undefined;
  kbDigest: string | undefined;

  plan: { steps: Array<{ id: string; title: string; tool: string | null }> } | undefined;

  toolTraceLines: string[] | undefined;
  roleStats: Record<"planner" | "retriever" | "auditor" | "coach" | "scheduler", number> | undefined;
  metrics: ReturnType<typeof createExecutionMetrics> | undefined;

  steps: LearningJobStepRecord[] | undefined;

  coachResult: unknown | undefined;

  // autonomous loop (single round for now)
  autoDecision: { needSearch: boolean; query?: string; reason?: string } | undefined;
  autoWebSearchResults: { query: string; results: Array<{ title?: string; url?: string; description?: string }> } | undefined;
  autoPick: { announce: string; selectedUrl: string; selectedTitle?: string } | undefined;
  autoFetched: { url: string; markdown: string } | undefined;
  autoAudit: { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] } | undefined;

  hitlOverrideUrl: string | undefined;

  waitingForUrl: boolean | undefined;
};

function pickDefaultUrlFromText(noteText: string): string | null {
  const m = Array.from((noteText ?? "").matchAll(/https?:\/\/[^\s)>\]]+/g)).map((x) => x[0]).filter(Boolean);
  return m[0] ?? null;
}

function stepStatus(steps: LearningJobStepRecord[] | undefined, id: string): LearningJobStepRecord["status"] | null {
  const s = Array.isArray(steps) ? steps.find((x) => x.id === id) : undefined;
  return s?.status ?? null;
}

function isDone(steps: LearningJobStepRecord[] | undefined, id: string): boolean {
  return stepStatus(steps, id) === "done";
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureNotInterrupted(jobId: string) {
  const latest = await prisma.learningJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!latest) throw new Error("任务不存在");
  if (latest.status === "CANCELLED") throw new Error("任务已被用户中断");
}

async function flushSteps(jobId: string, steps: LearningJobStepRecord[], extra?: { plan?: object }) {
  // 允许任务在执行中被“替换/删除”（例如旧版 resume 会创建新 job 并删除旧 job）：
  // 此时写 steps 不应把 worker 打崩，找不到记录则直接忽略。
  const r = await prisma.learningJob.updateMany({
    where: { id: jobId },
    data: {
      steps: steps as unknown as Prisma.InputJsonValue,
      ...(extra?.plan ? { plan: extra.plan as Prisma.InputJsonValue } : {}),
    },
  });
  if (r.count === 0) {
    return;
  }
}

async function callToolWithPolicy(params: {
  jobId: string;
  role: "planner" | "retriever" | "auditor" | "coach" | "scheduler";
  toolName: Parameters<typeof executeTool>[0];
  ctx: Parameters<typeof executeTool>[1];
  metrics: ReturnType<typeof createExecutionMetrics>;
  roleStats: NonNullable<NextClawLangGraphState["roleStats"]>;
  steps: LearningJobStepRecord[];
  retryStepLabel?: string;
}) {
  const policy = policyOf(params.role as any);
  let attempt = 0;
  while (true) {
    attempt += 1;
    params.metrics.toolCalls += 1;
    params.roleStats[params.role] += 1;
    const r = await executeTool(params.toolName as any, params.ctx as any);
    if (r.ok) return r;

    const allowRetryByPolicy = attempt <= policy.maxRetries;
    if (!allowRetryByPolicy || !shouldRetryTool(params.toolName as any, attempt, r)) {
      markToolFailureEffect(params.toolName as any, r, params.metrics);
      return r;
    }
    params.metrics.retries += 1;
    if (params.retryStepLabel) {
      params.steps.push({
        id: `${String(params.toolName)}-retry-${attempt}`,
        phase: "think",
        label: `${roleLabel(params.role as any)}：${params.retryStepLabel}`,
        status: "done",
        at: nowIso(),
        toolSummary: `第 ${attempt + 1} 次重试：${r.summary}`,
      });
      await flushSteps(params.jobId, params.steps);
    }
  }
}

function pushStep(state: NextClawLangGraphState, step: LearningJobStepRecord): NextClawLangGraphState {
  const steps = Array.isArray(state.steps) ? [...state.steps, step] : [step];
  return { ...state, steps };
}

function updateLastStep(
  state: NextClawLangGraphState,
  patch: Partial<Pick<LearningJobStepRecord, "status" | "toolSummary" | "label">>,
): NextClawLangGraphState {
  const steps = Array.isArray(state.steps) ? [...state.steps] : [];
  if (!steps.length) return state;
  const last = steps[steps.length - 1]!;
  steps[steps.length - 1] = { ...last, ...patch };
  return { ...state, steps };
}

async function buildCheckpointer() {
  // 默认先用内存 checkpointer，确保不依赖 DB 建表即可运行（避免破坏原有工作流）。
  // 需要持久化时再显式开启 NEXTCLAW_LANGGRAPH_PERSIST_CHECKPOINTS=1，并确保调用 .setup() 完成建表。
  const persist = (process.env.NEXTCLAW_LANGGRAPH_PERSIST_CHECKPOINTS ?? "").trim() === "1";
  if (!persist) {
    return new MemorySaver();
  }

  const db = process.env.DATABASE_URL;
  if (db && db.startsWith("postgres")) {
    try {
      const saver = await PostgresSaver.fromConnString(db);
      // IMPORTANT: 第一次使用必须 setup()，否则会报 relation "public.checkpoints" does not exist
      await saver.setup();
      return saver;
    } catch (e) {
      console.warn("[nextclaw/langgraph] PostgresSaver init failed, fallback to MemorySaver:", e);
    }
  }
  return new MemorySaver();
}

function buildNextClawGraph() {
  const State = new StateSchema({
    jobId: z.string(),
    userId: z.string(),
    noteId: z.string(),
    jobType: z.enum(["NOTE_LEARN_LITE", "NOTE_LEARN_DEEP"]),

    noteTitle: z.string().optional(),
    noteHtml: z.string().optional(),
    noteText: z.string().optional(),

    relatedNotes: z.any().optional(),
    relatedLines: z.any().optional(),
    kbDigest: z.string().optional(),

    plan: z.any().optional(),
    toolTraceLines: z.any().optional(),
    roleStats: z.any().optional(),
    metrics: z.any().optional(),
    steps: z.any().optional(),

    coachResult: z.any().optional(),

    autoDecision: z.any().optional(),
    autoWebSearchResults: z.any().optional(),
    autoPick: z.any().optional(),
    autoFetched: z.any().optional(),
    autoAudit: z.any().optional(),

    hitlOverrideUrl: z.string().optional(),
    waitingForUrl: z.boolean().optional(),
  });

  const builder = new StateGraph(State)
    .addNode("load_and_retrieve", async (state) => {
    await ensureNotInterrupted(state.jobId);

    // 断点恢复：优先载入 DB 已有 steps，避免重复调用工具/重复写 steps
    const existingStepsRow = await prisma.learningJob.findUnique({
      where: { id: state.jobId },
      select: { steps: true, plan: true, noteId: true, userId: true, type: true, noteUpdatedAt: true },
    });
    const existingSteps = Array.isArray(existingStepsRow?.steps)
      ? (existingStepsRow!.steps as LearningJobStepRecord[])
      : [];
    const baseState = existingSteps.length ? { ...state, steps: existingSteps } : state;
    if (isDone(baseState.steps, "retrieve")) {
      return baseState;
    }

    const s0: LearningJobStepRecord = {
      id: "retrieve",
      phase: "tool",
      label: `${roleLabel("retriever")}：检索相关笔记并构建知识库上下文（RAG）`,
      status: "running",
      toolName: "search_notes",
      at: nowIso(),
    };
    let next = pushStep(baseState, s0);
    await flushSteps(next.jobId, next.steps!);

    const job = existingStepsRow;
    const hitlOverrideUrl =
      job?.plan &&
      typeof job.plan === "object" &&
      !Array.isArray(job.plan) &&
      typeof (job.plan as any)?.__hitl?.overrideUrl === "string" &&
      String((job.plan as any).__hitl.overrideUrl).trim()
        ? String((job.plan as any).__hitl.overrideUrl).trim()
        : undefined;

    if (!job?.noteId) throw new Error("缺少 noteId");
    if (job.userId !== state.userId) throw new Error("用户不匹配");
    if (job.type !== state.jobType) {
      // 容错：外部传错时以 DB 为准，但仅允许 NOTE_LEARN_*
      if (job.type !== "NOTE_LEARN_LITE" && job.type !== "NOTE_LEARN_DEEP") {
        throw new Error("暂不支持的 job type");
      }
    }

    const note = await prisma.note.findFirst({
      where: { id: job.noteId, userId: state.userId },
      select: { id: true, title: true, content: true, updatedAt: true, archived: true },
    });
    if (!note || note.archived) throw new Error("笔记不存在或已归档");
    if (job.noteUpdatedAt && note.updatedAt.getTime() > job.noteUpdatedAt.getTime()) {
      throw new Error("笔记已更新，跳过旧版本任务");
    }

    const noteText = stripHtmlToText(note.content);
    const query = `${note.title}\n${noteText.slice(0, 1200)}`.trim();
    const topK = state.jobType === "NOTE_LEARN_DEEP" ? RAG_TOPK_DEEP : RAG_TOPK_LITE;
    const hits = await ragSearch({ userId: state.userId, query, topK });

    const byNote = new Map<string, { noteId: string; title: string; snippet: string; distance: number }>();
    for (const h of hits) {
      if (!h.noteId || h.noteId === note.id) continue;
      const exist = byNote.get(h.noteId);
      if (!exist || h.distance < exist.distance) {
        byNote.set(h.noteId, {
          noteId: h.noteId,
          title: h.noteTitle || "（无标题）",
          snippet: h.content,
          distance: h.distance,
        });
      }
    }
    const relatedNotes = Array.from(byNote.values()).slice(0, topK);
    const kbDigest = buildKbDigestFromRelated({ noteTitle: note.title, relatedNotes, maxNotes: topK });
    const relatedLines = relatedNotes.map((n) => {
      const plain = stripHtmlToText(n.snippet).replace(/\s+/g, " ").trim();
      return `${n.title}: ${plain.slice(0, 220)}`;
    });

    next = updateLastStep(next, {
      status: "done",
      toolSummary: `search_notes：命中 ${relatedNotes.length} 条相关笔记`,
    });
    await flushSteps(next.jobId, next.steps!);

    return {
      ...next,
      noteTitle: note.title,
      noteHtml: note.content,
      noteText,
      relatedNotes,
      relatedLines,
      kbDigest,
      hitlOverrideUrl,
    };
  })
    .addNode("auto_reason", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-reason")) return state;
      const s: LearningJobStepRecord = {
        id: "auto-reason",
        phase: "think",
        label: "判断是否需要联网补充来源（Autonomous Reasoning）",
        status: "running",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      const decision = await retrieverAgent.decideNeedWebSearch({
        noteTitle: state.noteTitle ?? "",
        noteText: state.noteText ?? "",
        kbDigest: state.kbDigest ?? "",
      });
      next = updateLastStep(next, {
        status: "done",
        toolSummary: decision.needSearch
          ? `需要搜索：${decision.query ?? ""}${decision.reason ? `（${decision.reason}）` : ""}`
          : "无需搜索：现有知识库已足够",
      });
      await flushSteps(next.jobId, next.steps!);
      return { ...next, autoDecision: decision };
    })
    .addNode("auto_web_search", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-web-search")) return state;
      const query = state.autoDecision?.query ?? "";
      const s: LearningJobStepRecord = {
        id: "auto-web-search",
        phase: "tool",
        label: query ? `自主搜索：${query}` : "自主搜索：生成搜索词",
        status: "running",
        toolName: "web_search",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      const metrics = next.metrics ?? createExecutionMetrics();
      const roleStats =
        next.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };

      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const r = await callToolWithPolicy({
        jobId: state.jobId,
        role: "retriever",
        toolName: "web_search",
        ctx: {
          userId: state.userId,
          note: jobNote,
          relatedNotes: state.relatedNotes ?? [],
          toolInput: { query, topK: 5 },
        },
        metrics,
        roleStats,
        steps: next.steps ?? [],
        retryStepLabel: "外部检索暂时失败，按策略自动重试",
      });

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      trace.push(`[web_search] ${r.summary}`);

      next = updateLastStep(next, { status: r.ok ? "done" : "failed", toolSummary: r.summary });
      await flushSteps(next.jobId, next.steps!);

      if (!r.ok) {
        return { ...next, metrics, roleStats, toolTraceLines: trace, autoWebSearchResults: undefined };
      }
      const d = r.data as { query?: string; results?: Array<{ title?: string; url?: string; description?: string }> } | null;
      const results = Array.isArray(d?.results) ? d!.results! : [];
      if (results.length === 0) {
        const warn = typeof (d as any)?.warning === "string" ? String((d as any).warning) : "";
        // 空结果：标记为可读的“无结果”，让后续路由进入 HITL 输入 URL，而不是静默跳过
        next = updateLastStep(next, {
          status: "done",
          toolSummary: `无结果：${warn || "未命中可用链接"}（可手动提供一个 URL 继续）`,
        });
        await flushSteps(next.jobId, next.steps!);
      }
      return {
        ...next,
        metrics,
        roleStats,
        toolTraceLines: trace,
        autoWebSearchResults: { query: typeof d?.query === "string" ? d.query : query, results },
      };
    })
    .addNode("hitl_need_url", async (state) => {
      // 进入等待：写一个明确步骤，并把任务置为 CANCELLED（等待用户提供 URL 再继续）
      if (isDone(state.steps, "hitl-need-url")) return state;
      const s: LearningJobStepRecord = {
        id: "hitl-need-url",
        phase: "think",
        label: "需要你提供一个可阅读的来源 URL（否则将跳过联网）",
        status: "done",
        at: nowIso(),
        toolSummary: "搜索无结果/不可用。请在任务详情中粘贴一个 URL，然后继续执行。",
      };
      const next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps ?? []);
      await prisma.learningJob.updateMany({
        where: { id: state.jobId },
        data: {
          status: "CANCELLED",
          finishedAt: new Date(),
          lastError: "等待用户提供来源 URL（HITL）",
        },
      });
      return { ...next, waitingForUrl: true };
    })
    .addNode("auto_filter", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-filter")) return state;
      const s: LearningJobStepRecord = {
        id: "auto-filter",
        phase: "think",
        label: "评估来源并选择优先阅读项（Filter）",
        status: "running",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      if (state.hitlOverrideUrl) {
        const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
        trace.push(`[hitl] overrideUrl=${state.hitlOverrideUrl}`);
        next = updateLastStep(next, { status: "done", toolSummary: `人工指定来源：${state.hitlOverrideUrl}` });
        await flushSteps(next.jobId, next.steps!);
        return {
          ...next,
          toolTraceLines: trace,
          autoPick: {
            announce: "已采用人工指定来源，跳过自动筛选。",
            selectedUrl: state.hitlOverrideUrl,
          },
        };
      }

      const query = state.autoWebSearchResults?.query ?? state.autoDecision?.query ?? "";
      const results = state.autoWebSearchResults?.results ?? [];
      const pick = await pickBestFromWebResults({ query, results });

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      trace.push(`[filter] ${pick.announce}`);

      next = updateLastStep(next, { status: "done", toolSummary: pick.announce });
      await flushSteps(next.jobId, next.steps!);
      return { ...next, toolTraceLines: trace, autoPick: { announce: pick.announce, selectedUrl: pick.selectedUrl, selectedTitle: pick.selectedTitle } };
    })
    .addNode("auto_fetch", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-fetch")) return state;
      const url = state.autoPick?.selectedUrl ?? "";
      const s: LearningJobStepRecord = {
        id: "auto-fetch",
        phase: "tool",
        label: url ? `深度阅读：抓取 ${url}` : "深度阅读：抓取来源",
        status: "running",
        toolName: "fetch_url",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      const metrics = next.metrics ?? createExecutionMetrics();
      const roleStats =
        next.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const r = await callToolWithPolicy({
        jobId: state.jobId,
        role: "retriever",
        toolName: "fetch_url",
        ctx: {
          userId: state.userId,
          note: jobNote,
          relatedNotes: state.relatedNotes ?? [],
          toolInput: { url },
        },
        metrics,
        roleStats,
        steps: next.steps ?? [],
        retryStepLabel: "网页抓取暂时失败，按策略自动重试",
      });

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      trace.push(`[fetch_url] ${r.summary}`);

      next = updateLastStep(next, { status: r.ok ? "done" : "failed", toolSummary: r.summary });
      await flushSteps(next.jobId, next.steps!);

      if (!r.ok) return { ...next, metrics, roleStats, toolTraceLines: trace };
      const d = r.data as { markdown?: string; url?: string } | null;
      const md = typeof d?.markdown === "string" ? d.markdown : "";
      const finalUrl = typeof d?.url === "string" ? d.url : url;
      return { ...next, metrics, roleStats, toolTraceLines: trace, autoFetched: md ? { url: finalUrl, markdown: md } : undefined };
    })
    .addNode("auto_audit", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-audit")) return state;
      const s: LearningJobStepRecord = {
        id: "auto-audit",
        phase: "think",
        label: `${roleLabel("auditor")}：对账审计（与知识库查漏补缺）`,
        status: "running",
        toolName: "audit_content",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      const metrics = next.metrics ?? createExecutionMetrics();
      const roleStats =
        next.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const r = await callToolWithPolicy({
        jobId: state.jobId,
        role: "auditor",
        toolName: "audit_content",
        ctx: {
          userId: state.userId,
          note: jobNote,
          relatedNotes: state.relatedNotes ?? [],
          toolInput: { newContent: state.autoFetched?.markdown ?? "" },
        },
        metrics,
        roleStats,
        steps: next.steps ?? [],
      });

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      trace.push(`[audit_content] ${r.summary}`);

      const d = (r.data ?? null) as { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] } | null;
      const auditSummary = auditorAgent.summarizeAuditCounts({
        conflicts: Array.isArray(d?.conflicts) ? d!.conflicts : [],
        fillGaps: Array.isArray(d?.fillGaps) ? d!.fillGaps : [],
        suggestedNoteIds: Array.isArray(d?.suggestedNoteIds) ? d!.suggestedNoteIds : [],
      });

      next = updateLastStep(next, {
        status: r.ok ? "done" : "failed",
        toolSummary: r.ok
          ? `${r.summary}（conflicts=${auditSummary.conflicts}, fillGaps=${auditSummary.fillGaps}, suggested=${auditSummary.suggested}）`
          : r.summary,
      });
      await flushSteps(next.jobId, next.steps!);

      return { ...next, metrics, roleStats, toolTraceLines: trace, autoAudit: d ?? undefined };
    })
    // NOTE: LangGraph 不允许 node name 与 state channel 同名；
    // state 里有 `plan`，因此节点名必须避开（例如 planner_node）。
    .addNode("planner_node", async (state) => {
    await ensureNotInterrupted(state.jobId);
    if (isDone(state.steps, "plan")) return state;

    const s: LearningJobStepRecord = {
      id: "plan",
      phase: "think",
      label: `${roleLabel("planner")}：生成 JSON 执行计划（Plan-Based）`,
      status: "running",
      at: nowIso(),
    };
    let next = pushStep(state, s);
    await flushSteps(next.jobId, next.steps!);

    const existingPlan =
      state.plan && typeof state.plan === "object" && Array.isArray((state.plan as { steps?: unknown }).steps)
        ? state.plan
        : null;
    const roleStats = state.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
    roleStats.planner += 1;

    const plan = existingPlan
      ? existingPlan
      : await plannerAgent.run({
          noteTitle: state.noteTitle ?? "",
          noteSnippet: state.noteText ?? "",
          relatedLines: state.relatedLines ?? [],
          jobType: state.jobType as any,
          urls: Array.from((state.noteText ?? "").matchAll(/https?:\/\/[^\s)>\]]+/g))
            .map((m) => m[0])
            .slice(0, 5),
        });

    next = updateLastStep(next, { status: "done", toolSummary: `steps=${plan.steps.length}` });
    await flushSteps(next.jobId, next.steps!, { plan });

    return { ...next, plan, roleStats, metrics: state.metrics ?? next.metrics, toolTraceLines: state.toolTraceLines ?? next.toolTraceLines };
  })
    .addNode("plan_executor", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "plan-exec")) return state;

      const planStepsRaw = Array.isArray(state.plan?.steps) ? state.plan!.steps : [];
      const planSteps = planStepsRaw
        .map((x: unknown) =>
          x && typeof x === "object" ? (x as { id?: unknown; title?: unknown; tool?: unknown }) : {},
        )
        .map((x: { id?: unknown; title?: unknown; tool?: unknown }) => ({
          id: typeof x.id === "string" && x.id.trim() ? x.id.trim() : "",
          title: typeof x.title === "string" && x.title.trim() ? x.title.trim() : "执行一步",
          tool: typeof x.tool === "string" ? x.tool : x.tool === null ? null : null,
        }))
        .filter((x: { id: string }) => x.id);

      const s0: LearningJobStepRecord = {
        id: "plan-exec",
        phase: "think",
        label: "执行计划步骤（Plan Executor）",
        status: "running",
        at: nowIso(),
      };
      let next = pushStep(state, s0);
      await flushSteps(next.jobId, next.steps!);

      if (!planSteps.length) {
        next = updateLastStep(next, { status: "done", toolSummary: "无可执行步骤（steps=0）" });
        await flushSteps(next.jobId, next.steps!);
        return next;
      }

      const metrics = next.metrics ?? createExecutionMetrics();
      const roleStats = next.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];

      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const defaultUrl =
        state.hitlOverrideUrl ||
        state.autoPick?.selectedUrl ||
        state.autoFetched?.url ||
        pickDefaultUrlFromText(state.noteText ?? "") ||
        "";

      let executed = 0;
      let skipped = 0;
      for (const ps of planSteps) {
        await ensureNotInterrupted(state.jobId);
        const tool = (ps.tool ?? "noop") as PlanToolName;

        // 断点恢复：计划步骤已完成则跳过
        if (isDone(next.steps, ps.id)) {
          continue;
        }

        // synthesize 由 coach 节点统一执行，避免重复
        if (tool === "synthesize") {
          next.steps = next.steps ?? [];
          next.steps.push({
            id: ps.id,
            phase: "done",
            label: `${ps.title}（由 Coach 统一生成）`,
            status: "done",
            toolName: tool,
            at: nowIso(),
          });
          await flushSteps(next.jobId, next.steps);
          skipped += 1;
          continue;
        }

        // noop 或未指定工具：直接标记 done
        if (!tool || tool === "noop") {
          next.steps = next.steps ?? [];
          next.steps.push({
            id: ps.id,
            phase: "done",
            label: ps.title,
            status: "done",
            toolName: "noop",
            at: nowIso(),
            toolSummary: "跳过（无工具）",
          });
          await flushSteps(next.jobId, next.steps);
          skipped += 1;
          continue;
        }

        const stepRec: LearningJobStepRecord = {
          id: ps.id,
          phase: tool === "search_notes" || tool === "read_note" || tool === "web_search" || tool === "fetch_url" ? "tool" : "think",
          label: ps.title,
          status: "running",
          toolName: tool,
          at: nowIso(),
        };
        next = pushStep(next, stepRec);
        await flushSteps(next.jobId, next.steps!);

        const planToolInputRaw =
          (ps as any)?.toolInput && typeof (ps as any).toolInput === "object" && !Array.isArray((ps as any).toolInput)
            ? ((ps as any).toolInput as Record<string, unknown>)
            : undefined;
        const planToolInput = planToolInputRaw ? { ...planToolInputRaw } : undefined;

        const toolInput =
          tool === "web_search"
            ? {
                query:
                  (typeof planToolInput?.query === "string" && planToolInput.query.trim()) ||
                  `学习 ${state.noteTitle ?? ""}（官网 GitHub 文档 教程）`,
                topK: typeof planToolInput?.topK === "number" ? planToolInput.topK : 5,
              }
            : tool === "fetch_url"
              ? {
                  url:
                    (typeof planToolInput?.url === "string" && planToolInput.url.trim() && planToolInput.url !== "$best_url")
                      ? planToolInput.url.trim()
                      : defaultUrl,
                }
              : tool === "read_note"
                ? {
                    ...(typeof planToolInput?.noteId === "string" && planToolInput.noteId.trim()
                      ? { noteId: planToolInput.noteId.trim() }
                      : {}),
                  }
                : tool === "audit_content"
                  ? {
                      newContent:
                        typeof planToolInput?.newContent === "string" && planToolInput.newContent === "$fetched_markdown"
                          ? state.autoFetched?.markdown ?? ""
                          : (typeof planToolInput?.newContent === "string" ? planToolInput.newContent : (state.autoFetched?.markdown ?? "")),
                    }
                  : planToolInput;

        const role = tool === "audit_content" ? "auditor" : "retriever";

        // HITL：若计划执行遇到 fetch_url 但仍然没有可用 url，则进入等待用户提供来源
        if (tool === "fetch_url" && typeof (toolInput as any)?.url === "string" && !(toolInput as any).url.trim()) {
          next = updateLastStep(next, {
            status: "done",
            toolSummary: "缺少可用 URL：需要你提供一个来源链接后才能继续（HITL）",
          });
          await flushSteps(next.jobId, next.steps!);
          return { ...next, waitingForUrl: true };
        }

        const r = await callToolWithPolicy({
          jobId: state.jobId,
          role: role as any,
          toolName: tool,
          ctx: {
            userId: state.userId,
            note: jobNote,
            relatedNotes: state.relatedNotes ?? [],
            ...(toolInput ? { toolInput } : {}),
          },
          metrics,
          roleStats,
          steps: next.steps ?? [],
          retryStepLabel:
            tool === "web_search"
              ? "外部检索暂时失败，按策略自动重试"
              : tool === "fetch_url"
                ? "网页抓取暂时失败，按策略自动重试"
                : undefined,
        });

        trace.push(`[${ps.id}] ${r.summary}`);
        next = updateLastStep(next, { status: r.ok ? "done" : "failed", toolSummary: r.summary });
        await flushSteps(next.jobId, next.steps!);
        if (!r.ok) {
          // audit_content 属于“可降级”的非核心步骤：失败不应让整单失败（尤其是 MCP 未启用时）
          if (tool === "audit_content") {
            skipped += 1;
            continue;
          }
          // 保持“计划执行失败即失败”的语义；HITL（提供 URL）走 auto_web_search 的无结果分支，不从这里兜底
          throw new Error(r.summary);
        }
        executed += 1;
      }

      next = updateLastStep(next, {
        status: "done",
        toolSummary: `executed=${executed}; skipped=${skipped}`,
      });
      await flushSteps(next.jobId, next.steps!);
      return { ...next, metrics, roleStats, toolTraceLines: trace };
    })
    .addNode("coach", async (state) => {
    await ensureNotInterrupted(state.jobId);
    if (isDone(state.steps, "coach")) return state;

    const s: LearningJobStepRecord = {
      id: "coach",
      phase: "think",
      label: `${roleLabel("coach")}：生成学习卡片与讲解内容`,
      status: "running",
      toolName: "synthesize",
      at: nowIso(),
    };
    let next = pushStep(state, s);
    await flushSteps(next.jobId, next.steps!);

    const roleStats = state.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
    roleStats.coach += 1;

    const toolTraceLines = Array.isArray(state.toolTraceLines) ? state.toolTraceLines : [];
    const lite = await coachAgent.run({
      noteTitle: state.noteTitle ?? "",
      noteHtml: state.noteHtml ?? "",
      relatedNotes: state.relatedNotes ?? [],
      kbDigest: state.kbDigest,
      toolTrace: toolTraceLines.join("\n"),
      mode: state.jobType === "NOTE_LEARN_DEEP" ? "deep" : "lite",
    });

    next = updateLastStep(next, { status: "done", toolSummary: `cards=${lite.cards.length}` });
    await flushSteps(next.jobId, next.steps!);

    return { ...next, roleStats, toolTraceLines, coachResult: lite, metrics: state.metrics ?? next.metrics };
  })
    .addNode("persist", async (state: NextClawLangGraphState & { coachResult?: any }) => {
    await ensureNotInterrupted(state.jobId);
    if (isDone(state.steps, "persist")) return state;

    const s: LearningJobStepRecord = {
      id: "persist",
      phase: "done",
      label: "写入学习卡片与复习任务",
      status: "running",
      at: nowIso(),
    };
    let next = pushStep(state, s);
    await flushSteps(next.jobId, next.steps!);

    const job = await prisma.learningJob.findUnique({
      where: { id: state.jobId },
      select: { noteId: true, userId: true, noteUpdatedAt: true },
    });
    if (!job?.noteId) throw new Error("缺少 noteId");

    const note = await prisma.note.findFirst({
      where: { id: job.noteId, userId: state.userId },
      select: { id: true, updatedAt: true },
    });
    if (!note) throw new Error("笔记不存在");

    const lite = state.coachResult;
    const cards = Array.isArray(lite?.cards) ? lite.cards : [];

    // 如果 autonomous audit 有结果，插入一张审计卡（让用户明确看到 agent 的“对账过程”）
    const audit = state.autoAudit;
    if (audit && cards.length) {
      const conflicts = Array.isArray(audit.conflicts) ? audit.conflicts.slice(0, 6) : [];
      const fillGaps = Array.isArray(audit.fillGaps) ? audit.fillGaps.slice(0, 6) : [];
      const suggestIds = Array.isArray(audit.suggestedNoteIds) ? audit.suggestedNoteIds.slice(0, 6) : [];
      const suggestNotes = suggestIds.length
        ? await prisma.note.findMany({
            where: { userId: state.userId, id: { in: suggestIds } },
            select: { id: true, title: true },
            take: 12,
          })
        : [];
      const titleById = new Map(suggestNotes.map((n) => [n.id, n.title || "（无标题）"]));
      const suggestLines = suggestIds.map((id) => {
        const t = titleById.get(id);
        return t ? `- 《${t}》` : `- ${id}`;
      });
      const md = [
        state.autoFetched?.url ? `来源：${state.autoFetched.url}` : null,
        "",
        conflicts.length ? "## 冲突点" : null,
        conflicts.length ? conflicts.map((x) => `- ${x}`).join("\n") : null,
        "",
        fillGaps.length ? "## 知识补位点" : null,
        fillGaps.length ? fillGaps.map((x) => `- ${x}`).join("\n") : null,
        "",
        suggestLines.length ? "## 建议关联的笔记" : null,
        suggestLines.length ? suggestLines.join("\n") : null,
      ]
        .filter((x) => typeof x === "string" && x.length > 0)
        .join("\n");
      cards.unshift({
        type: "AUDIT",
        title: "知识审计：与知识库对比",
        contentMd: md || "（审计完成：未发现明显冲突或补位点）",
        sources: { suggestedNoteIds: suggestIds },
      });
    }

    await prisma.learningCard.deleteMany({
      where: { userId: state.userId, noteId: job.noteId, noteUpdatedAt: job.noteUpdatedAt ?? undefined },
    });

    await prisma.learningCard.createMany({
      data: cards.map((c: any) => ({
        userId: state.userId,
        noteId: job.noteId,
        type: c.type,
        title: c.title,
        contentMd: c.contentMd,
        sources: c.sources ?? {
          relatedNotes: (state.relatedNotes ?? []).map((n) => ({ noteId: n.noteId, title: n.title, distance: n.distance })),
        },
        noteUpdatedAt: job.noteUpdatedAt ?? note.updatedAt,
      })),
    });

    const roleStats = state.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };
    roleStats.scheduler += 1;
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.reviewItem.upsert({
      where: { userId_noteId: { userId: state.userId, noteId: job.noteId } },
      create: { userId: state.userId, noteId: job.noteId, dueDate, intervalDays: 1, easeFactor: 2.5 },
      update: { dueDate },
    });

    next = updateLastStep(next, { status: "done", toolSummary: `cards=${cards.length}` });
    await flushSteps(next.jobId, next.steps!);

    return { ...next, roleStats, metrics: state.metrics ?? next.metrics, toolTraceLines: state.toolTraceLines ?? next.toolTraceLines };
  })
    .addNode("finalize", async (state) => {
    if (isDone(state.steps, "evaluation") || isDone(state.steps, "evaluation-failed")) return state;
    const metrics = state.metrics ?? createExecutionMetrics();
    const evaluation = toEvaluationSummary(metrics);

    const roleStats = state.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 };

    let next = state;
    next = pushStep(next, {
      id: "orchestrator-langgraph",
      phase: "done",
      label: "多 Agent 编排摘要（LangGraph）",
      status: "done",
      at: nowIso(),
      toolSummary: `planner=${roleStats.planner}; retriever=${roleStats.retriever}; auditor=${roleStats.auditor}; coach=${roleStats.coach}; scheduler=${roleStats.scheduler}`,
    });
    next = pushStep(next, {
      id: "evaluation",
      phase: "done",
      label: "任务评估与闭环记录",
      status: "done",
      at: nowIso(),
      toolSummary: `toolCalls=${evaluation.toolCalls}; retries=${evaluation.retries}; degraded=${evaluation.degraded ? "yes" : "no"}; needHuman=${evaluation.needHumanIntervention ? "yes" : "no"}; durationMs=${evaluation.durationMs}`,
    });
    await flushSteps(next.jobId, next.steps ?? []);

    await prisma.learningJob.updateMany({
      where: { id: state.jobId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null },
    });
    return next;
  })
    .addEdge(START, "load_and_retrieve")
    .addEdge("load_and_retrieve", "auto_reason")
    .addConditionalEdges(
      "auto_reason",
      (s) => {
        if (s.autoDecision?.needSearch && s.autoDecision?.query) return "need_search";
        return "skip";
      },
      {
        need_search: "auto_web_search",
        skip: "planner_node",
      },
    )
    .addConditionalEdges(
      "auto_web_search",
      (s) => {
        if (s.steps?.at(-1)?.status === "failed") return "skip";
        // web_search 无结果：进入 HITL 等待用户输入 URL
        if (Array.isArray(s.autoWebSearchResults?.results) && s.autoWebSearchResults!.results.length === 0) return "need_url";
        if (!s.autoWebSearchResults?.results?.length) return "skip";
        return "go";
      },
      {
        go: "auto_filter",
        need_url: "hitl_need_url",
        skip: "planner_node",
      },
    )
    .addConditionalEdges(
      "auto_filter",
      (s) => (s.autoPick?.selectedUrl ? "go" : "skip"),
      { go: "auto_fetch", skip: "planner_node" },
    )
    .addConditionalEdges(
      "auto_fetch",
      (s) => (s.autoFetched?.markdown ? "go" : "skip"),
      { go: "auto_audit", skip: "planner_node" },
    )
    .addEdge("auto_audit", "planner_node")
    .addConditionalEdges(
      "planner_node",
      (s) => (Array.isArray(s.plan?.steps) && s.plan!.steps.length > 0 ? "exec" : "skip"),
      { exec: "plan_executor", skip: "coach" },
    )
    .addConditionalEdges(
      "plan_executor",
      (s) => (s.waitingForUrl ? "need_url" : "go"),
      { need_url: "hitl_need_url", go: "coach" },
    )
    .addEdge("coach", "persist")
    .addEdge("persist", "finalize")
    .addEdge("finalize", END);

  return builder;
}

/**
 * LangGraph PoC：Retrieve → Plan → Coach → Persist。
 * - 以 `jobId` 作为 thread_id 便于 checkpoint/恢复
 * - 每个节点会实时写入 `learningJob.steps`，供现有 UI 展示
 */
export async function runNextClawLangGraphJob(params: {
  jobId: string;
  userId: string;
  noteId: string;
  jobType: JobType;
}) {
  const checkpointer = await buildCheckpointer();
  const graph = buildNextClawGraph().compile({ checkpointer });

  const threadConfig: any = { configurable: { thread_id: params.jobId } };
  // 尝试从 checkpointer 读取最近一次 checkpoint（若存在，则在同 thread 上继续）。
  // 这会让 resume 更接近“真正恢复”而不是完全重跑。
  try {
    if (typeof (checkpointer as any)?.getTuple === "function") {
      const tuple = await (checkpointer as any).getTuple(threadConfig);
      const ckptConfig = tuple?.config?.configurable ?? null;
      if (ckptConfig?.checkpoint_id) {
        threadConfig.configurable = {
          ...threadConfig.configurable,
          checkpoint_id: ckptConfig.checkpoint_id,
          ...(ckptConfig.checkpoint_ns ? { checkpoint_ns: ckptConfig.checkpoint_ns } : {}),
        };
      }
      const channelValues = tuple?.checkpoint?.channel_values ?? null;
      if (channelValues && typeof channelValues === "object") {
        // 用 checkpoint state 作为启动 state，补齐关键字段（防止脏数据导致 user/note 不一致）
        const resumed = channelValues as Partial<NextClawLangGraphState>;
        const initFromCheckpoint: NextClawLangGraphState = {
          jobId: params.jobId,
          userId: params.userId,
          noteId: params.noteId,
          jobType: params.jobType,
          noteTitle: resumed.noteTitle,
          noteHtml: resumed.noteHtml,
          noteText: resumed.noteText,
          relatedNotes: resumed.relatedNotes,
          relatedLines: resumed.relatedLines,
          kbDigest: resumed.kbDigest,
          plan: resumed.plan,
          metrics: resumed.metrics ?? createExecutionMetrics(),
          toolTraceLines: resumed.toolTraceLines ?? [],
          roleStats: resumed.roleStats ?? { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 },
          steps: Array.isArray(resumed.steps) ? resumed.steps : [],
          coachResult: resumed.coachResult,
          autoDecision: resumed.autoDecision,
          autoWebSearchResults: resumed.autoWebSearchResults,
          autoPick: resumed.autoPick,
          autoFetched: resumed.autoFetched,
          autoAudit: resumed.autoAudit,
          hitlOverrideUrl: resumed.hitlOverrideUrl,
          waitingForUrl: resumed.waitingForUrl ?? false,
        };
        await prisma.learningJob.updateMany({
          where: { id: params.jobId },
          data: { status: "RUNNING", startedAt: new Date(), finishedAt: null },
        });
        try {
          await graph.invoke(initFromCheckpoint, threadConfig);
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const metrics = initFromCheckpoint.metrics ?? createExecutionMetrics();
          const evaluation = toEvaluationSummary(metrics);
          const steps = Array.isArray(initFromCheckpoint.steps) ? [...initFromCheckpoint.steps] : [];
          steps.push({
            id: "evaluation-failed",
            phase: "done",
            label: "任务评估（失败路径）",
            status: "failed",
            at: nowIso(),
            toolSummary: `err=${msg}; toolCalls=${evaluation.toolCalls}; retries=${evaluation.retries}; degraded=${evaluation.degraded ? "yes" : "no"}; needHuman=${evaluation.needHumanIntervention ? "yes" : "no"}; durationMs=${evaluation.durationMs}`,
          });
          await flushSteps(params.jobId, steps);
          await prisma.learningJob.updateMany({
            where: { id: params.jobId },
            data: { status: "FAILED", finishedAt: new Date(), lastError: msg, steps: steps as unknown as Prisma.InputJsonValue },
          });
          return;
        }
      }
    }
  } catch (e) {
    console.warn("[nextclaw/langgraph] resume from checkpoint failed, fallback to fresh run:", e);
  }

  const init: NextClawLangGraphState = {
    jobId: params.jobId,
    userId: params.userId,
    noteId: params.noteId,
    jobType: params.jobType,
    noteTitle: undefined,
    noteHtml: undefined,
    noteText: undefined,
    relatedNotes: undefined,
    relatedLines: undefined,
    kbDigest: undefined,
    plan: undefined,
    metrics: createExecutionMetrics(),
    toolTraceLines: [],
    roleStats: { planner: 0, retriever: 0, auditor: 0, coach: 0, scheduler: 0 },
    steps: [],
    coachResult: undefined,
    autoDecision: undefined,
    autoWebSearchResults: undefined,
    autoPick: undefined,
    autoFetched: undefined,
    autoAudit: undefined,
    hitlOverrideUrl: undefined,
    waitingForUrl: false,
  };

  await prisma.learningJob.updateMany({
    where: { id: params.jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    await graph.invoke(init, threadConfig);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const metrics = init.metrics ?? createExecutionMetrics();
    const evaluation = toEvaluationSummary(metrics);
    const steps = Array.isArray(init.steps) ? [...init.steps] : [];
    steps.push({
      id: "evaluation-failed",
      phase: "done",
      label: "任务评估（失败路径）",
      status: "failed",
      at: nowIso(),
      toolSummary: `err=${msg}; toolCalls=${evaluation.toolCalls}; retries=${evaluation.retries}; degraded=${evaluation.degraded ? "yes" : "no"}; needHuman=${evaluation.needHumanIntervention ? "yes" : "no"}; durationMs=${evaluation.durationMs}`,
    });
    await flushSteps(params.jobId, steps);
    await prisma.learningJob.updateMany({
      where: { id: params.jobId },
      data: { status: "FAILED", finishedAt: new Date(), lastError: msg, steps: steps as unknown as Prisma.InputJsonValue },
    });
  }
}

