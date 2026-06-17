import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ragSearch, stripHtmlToText } from "@/lib/rag";
import { buildKbDigestFromRelated } from "@/lib/nextclaw-kb-digest";
import {
  auditorAgent,
  coachAgent,
  plannerAgent,
  retrieverAgent,
  roleLabel,
  sourceAnalystAgent,
  supervisorAgent,
  type AgentRole,
} from "@/lib/nextclaw-multi-agent";
import type {
  LearningJobStepRecord,
  NextClawAuditIssue,
  NextClawAuditSummary,
  NextClawHitlState,
} from "@/lib/nextclaw-agent-types";
import type { NextClawAutoLearnLiteCard } from "@/lib/nextclaw-auto-learn";
import { executeTool } from "@/lib/nextclaw-agent-tools";
import { pickBestByHeuristic } from "@/lib/nextclaw-autonomous-loop";
import { policyOf } from "@/lib/nextclaw-orchestrator-policy";
import {
  createExecutionMetrics,
  markToolFailureEffect,
  shouldRetryTool,
  toEvaluationSummary,
} from "@/lib/nextclaw-workflow-policy";
import {
  PARALLEL_AUDIT_ENABLED,
  PARALLEL_FETCH_LIMIT,
  RAG_TOPK_DEEP,
  RAG_TOPK_LITE,
  SUPERVISOR_LLM_ROUTING,
} from "@/lib/nextclaw-agent-config";
import type { PlanToolName } from "@/lib/nextclaw-agent-types";
import { runNextClawSkill } from "@/lib/nextclaw-skills";
import { emitLearningJobEvent } from "@/lib/learning-job-events";

type JobType = "NOTE_LEARN_LITE" | "NOTE_LEARN_DEEP";

type RelatedNote = { noteId: string; title: string; snippet: string; distance?: number };
type RoleStats = Record<AgentRole, number>;
type CandidateSource = { url: string; title?: string; description?: string; trustScore: number; trustLevel: string };
type FetchedCandidate = CandidateSource & { markdown: string; summary: string; chars: number };
type HitlPlanMeta = { __hitl?: { overrideUrl?: string } };
type WebSearchToolData = {
  query?: string;
  results?: Array<{ title?: string; url?: string; description?: string }>;
  warning?: string;
};
type CheckpointConfig = {
  configurable?: {
    thread_id?: string;
    checkpoint_id?: string;
    checkpoint_ns?: string;
  };
};
type CheckpointTupleLike = {
  config?: CheckpointConfig;
  checkpoint?: {
    channel_values?: unknown;
  };
};
type CheckpointerWithTuple = {
  getTuple?: (config: CheckpointConfig) => Promise<CheckpointTupleLike | null>;
};
type PersistCard = {
  type: NextClawAutoLearnLiteCard["type"];
  title: string;
  contentMd: string;
  sources?: unknown;
};

/**
 * NextClaw LangGraph 全局状态。
 *
 * 字段按 5 个逻辑子状态分组（详见 lib/nextclaw-agent-types.ts）：
 * - DocumentSubState:  load_and_retrieve 生产，其余只读
 * - RetrievalSubState: supervisor + auto_* 节点生产，planner 只读消费
 * - PlanSubState:      planner_node / plan_executor 生产
 * - AuditSubState:     auto_audit 生产
 * - RuntimeSubState:   graph runner 初始化，所有节点可读
 *
 * 所有权映射见 NEXTCLAW_STATE_OWNERSHIP。
 */
export type NextClawLangGraphState = {
  // ── 运行时态（graph runner 初始化，只读）──
  jobId: string;
  userId: string;
  noteId: string;
  jobType: JobType;

  // ── 文档态（load_and_retrieve 生产）──
  noteTitle: string | undefined;
  noteHtml: string | undefined;
  noteText: string | undefined;
  noteSourceType: string | undefined;
  relatedNotes: RelatedNote[] | undefined;
  relatedLines: string[] | undefined;
  kbDigest: string | undefined;

  // ── 计划态（planner_node / plan_executor 生产）──
  plan: { steps: Array<{ id: string; title: string; tool: string | null }> } | undefined;
  toolTraceLines: string[] | undefined;

  // ── 运行时态（各节点追加）──
  roleStats: RoleStats | undefined;
  metrics: ReturnType<typeof createExecutionMetrics> | undefined;
  steps: LearningJobStepRecord[] | undefined;
  coachResult: unknown | undefined;

  // ── 检索态（supervisor + auto_* 节点生产）──
  autoDecision: { needSearch: boolean; query?: string; reason?: string } | undefined;
  supervisorDecision: { route: "direct_plan" | "retrieve_and_search" | "retrieve_only"; reason: string } | undefined;
  autoWebSearchResults: { query: string; results: Array<{ title?: string; url?: string; description?: string }> } | undefined;
  autoCandidates: CandidateSource[] | undefined;
  autoPick: { announce: string; selectedUrl: string; selectedTitle?: string } | undefined;
  autoFetchedCandidates: FetchedCandidate[] | undefined;
  autoFetched: { url: string; markdown: string } | undefined;

  // ── 审计态（auto_audit 生产）──
  autoAudit: NextClawAuditSummary | undefined;

  // ── 运行时态（HITL 挂起/恢复）──
  hitl: NextClawHitlState | undefined;
};

function pickDefaultUrlFromText(noteText: string): string | null {
  const m = Array.from((noteText ?? "").matchAll(/https?:\/\/[^\s)>\]]+/g)).map((x) => x[0]).filter(Boolean);
  return m[0] ?? null;
}

function stepStatus(steps: LearningJobStepRecord[] | undefined, id: string): LearningJobStepRecord["status"] | null {
  const s = Array.isArray(steps) ? [...steps].reverse().find((x) => x.id === id) : undefined;
  return s?.status ?? null;
}

function isDone(steps: LearningJobStepRecord[] | undefined, id: string): boolean {
  return stepStatus(steps, id) === "done";
}

function uniqStepsKeepLatest(steps: LearningJobStepRecord[]): LearningJobStepRecord[] {
  const out: LearningJobStepRecord[] = [];
  const seen = new Set<string>();
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = steps[i]!;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.unshift(s);
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function createRoleStats(): RoleStats {
  return {
    supervisor: 0,
    planner: 0,
    retriever: 0,
    source_analyst: 0,
    auditor: 0,
    coach: 0,
    scheduler: 0,
  };
}

function summarizeText(input: string | undefined, max = 160): string {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asPlanToolInput(value: unknown): Record<string, unknown> | undefined {
  const obj = asObject(value);
  return obj ? { ...obj } : undefined;
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
      steps,
      ...(extra?.plan ? { plan: extra.plan } : {}),
    },
  });
  if (r.count === 0) {
    return;
  }
  // 尽力读取 userId（用于 SSE 过滤）；失败则跳过（不会影响任务执行）
  try {
    const row = await prisma.learningJob.findUnique({ where: { id: jobId }, select: { userId: true } });
    if (row?.userId) {
      emitLearningJobEvent({ type: "job_updated", userId: row.userId, jobId });
      emitLearningJobEvent({ type: "jobs_changed", userId: row.userId });
    }
  } catch {
    // ignore
  }
}

async function callToolWithPolicy(params: {
  jobId: string;
  role: AgentRole;
  toolName: Parameters<typeof executeTool>[0];
  ctx: Parameters<typeof executeTool>[1];
  metrics: ReturnType<typeof createExecutionMetrics>;
  roleStats: RoleStats;
  steps: LearningJobStepRecord[];
  retryStepLabel?: string;
}) {
  const policy = policyOf(params.role);
  let attempt = 0;
  while (true) {
    attempt += 1;
    params.metrics.toolCalls += 1;
    params.roleStats[params.role] += 1;
    const r = await executeTool(params.toolName, params.ctx);
    if (r.ok) return r;

    const allowRetryByPolicy = attempt <= policy.maxRetries;
    if (!allowRetryByPolicy || !shouldRetryTool(params.toolName, attempt, r)) {
      markToolFailureEffect(params.toolName, r, params.metrics);
      return r;
    }
    params.metrics.retries += 1;
    if (params.retryStepLabel) {
      params.steps.push({
        id: `${String(params.toolName)}-retry-${attempt}`,
        phase: "think",
        label: `${roleLabel(params.role)}：${params.retryStepLabel}`,
        status: "done",
        at: nowIso(),
        toolSummary: `第 ${attempt + 1} 次重试：${r.summary}`,
      });
      await flushSteps(params.jobId, params.steps);
    }
  }
}

function pushStep(state: NextClawLangGraphState, step: LearningJobStepRecord): NextClawLangGraphState {
  const merged = Array.isArray(state.steps) ? [...state.steps, step] : [step];
  const steps = uniqStepsKeepLatest(merged);
  return { ...state, steps };
}

function updateLastStep(
  state: NextClawLangGraphState,
  patch: Partial<Pick<LearningJobStepRecord, "status" | "toolSummary" | "label" | "meta">>,
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

function markStepMeta(
  state: NextClawLangGraphState,
  meta: NonNullable<LearningJobStepRecord["meta"]>,
): NextClawLangGraphState {
  const steps = Array.isArray(state.steps) ? [...state.steps] : [];
  if (!steps.length) return state;
  const last = steps[steps.length - 1]!;
  steps[steps.length - 1] = {
    ...last,
    meta: {
      ...(last.meta ?? {}),
      ...meta,
      communication: meta.communication ?? last.meta?.communication,
    },
  };
  return { ...state, steps };
}

function withAgentTrace(params: {
  state: NextClawLangGraphState;
  role: AgentRole;
  inputSummary: string;
  outputSummary: string;
  handoffTo: NonNullable<LearningJobStepRecord["meta"]>["handoffTo"];
  startedAtMs: number;
  candidateCount?: number;
  parallelTasks?: number;
  toolDomain?: NonNullable<LearningJobStepRecord["meta"]>["toolDomain"];
  communication?: string[];
}) {
  return markStepMeta(params.state, {
    agentRole: params.role,
    inputSummary: summarizeText(params.inputSummary, 180),
    outputSummary: summarizeText(params.outputSummary, 220),
    handoffTo: params.handoffTo,
    durationMs: Math.max(0, Date.now() - params.startedAtMs),
    ...(typeof params.candidateCount === "number" ? { candidateCount: params.candidateCount } : {}),
    ...(typeof params.parallelTasks === "number" ? { parallelTasks: params.parallelTasks } : {}),
    ...(params.toolDomain ? { toolDomain: params.toolDomain } : {}),
    ...(params.communication?.length ? { communication: params.communication } : {}),
  });
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
    noteSourceType: z.string().optional(),

    relatedNotes: z.any().optional(),
    relatedLines: z.any().optional(),
    kbDigest: z.string().optional(),

    plan: z.any().optional(),
    toolTraceLines: z.any().optional(),
    roleStats: z.any().optional(),
    metrics: z.any().optional(),
    steps: z.any().optional(),

    coachResult: z.any().optional(),

    supervisorDecision: z.any().optional(),
    autoDecision: z.any().optional(),
    autoWebSearchResults: z.any().optional(),
    autoCandidates: z.any().optional(),
    autoPick: z.any().optional(),
    autoFetchedCandidates: z.any().optional(),
    autoFetched: z.any().optional(),
    autoAudit: z.any().optional(),

    hitl: z.any().optional(),
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
    const planMeta = asObject(job?.plan) as HitlPlanMeta | null;
    const hitlOverrideUrl =
      typeof planMeta?.__hitl?.overrideUrl === "string" && planMeta.__hitl.overrideUrl.trim()
        ? planMeta.__hitl.overrideUrl.trim()
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
      select: { id: true, title: true, content: true, updatedAt: true, archived: true, sourceType: true },
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
      noteSourceType: note.sourceType ?? undefined,
      relatedNotes,
      relatedLines,
      kbDigest,
      hitlOverrideUrl,
    };
  })
    .addNode("supervisor", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "supervisor")) return state;

      const startedAtMs = Date.now();
      const s: LearningJobStepRecord = {
        id: "supervisor",
        phase: "think",
        label: `${roleLabel("supervisor")}：判断任务路由与自治深度`,
        status: "running",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      const roleStats = next.roleStats ?? createRoleStats();
      roleStats.supervisor += 1;
      const decision = SUPERVISOR_LLM_ROUTING
        ? await supervisorAgent.runWithLLM({
            noteSourceType: state.noteSourceType,
            noteText: state.noteText,
            hasRelatedNotes: (state.relatedNotes?.length ?? 0) > 0,
            requestedMode: state.jobType,
            hitlOverrideUrl: state.hitl?.overrideUrl,
          })
        : supervisorAgent.run({
            noteSourceType: state.noteSourceType,
            noteText: state.noteText,
            hasRelatedNotes: (state.relatedNotes?.length ?? 0) > 0,
            requestedMode: state.jobType,
            hitlOverrideUrl: state.hitl?.overrideUrl,
          });

      next = updateLastStep(next, {
        status: "done",
        toolSummary: `${decision.route}：${decision.reason}`,
      });
      next = withAgentTrace({
        state: next,
        role: "supervisor",
        inputSummary: `sourceType=${state.noteSourceType ?? "unknown"}; related=${state.relatedNotes?.length ?? 0}; mode=${state.jobType}`,
        outputSummary: decision.reason,
        handoffTo:
          decision.route === "direct_plan"
            ? "planner"
            : decision.route === "retrieve_and_search"
              ? "retriever"
              : "retriever",
        startedAtMs,
        communication: [`route=${decision.route}`],
      });
      await flushSteps(next.jobId, next.steps!);
      return { ...next, roleStats, supervisorDecision: decision };
    })
    .addNode("auto_reason", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-reason")) return state;
      const startedAtMs = Date.now();

      // capture 来源笔记正文已完整，无需联网搜索
      if (state.noteSourceType === "capture") {
        const s: LearningJobStepRecord = {
          id: "auto-reason",
          phase: "think",
          label: "判断是否需要联网补充来源（Autonomous Reasoning）",
          status: "done",
          at: nowIso(),
          toolSummary: "无需搜索：capture 笔记正文已完整",
        };
        let next = pushStep(state, s);
        next = withAgentTrace({
          state: next,
          role: "retriever",
          inputSummary: "capture 来源已具备完整正文",
          outputSummary: "无需联网搜索",
          handoffTo: "planner",
          startedAtMs,
        });
        await flushSteps(next.jobId, next.steps!);
        return { ...next, autoDecision: { needSearch: false, reason: "capture 笔记正文已完整" } };
      }

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
      next = withAgentTrace({
        state: next,
        role: "retriever",
        inputSummary: `title=${state.noteTitle ?? ""}; kbDigestChars=${state.kbDigest?.length ?? 0}`,
        outputSummary: decision.needSearch ? `需要补源：${decision.query ?? ""}` : "知识库上下文已足够",
        handoffTo: decision.needSearch ? "retriever" : "planner",
        startedAtMs,
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
      const roleStats = next.roleStats ?? createRoleStats();

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
      const d = r.data as WebSearchToolData | null;
      const results = Array.isArray(d?.results) ? d!.results! : [];
      if (results.length === 0) {
        const warn = typeof d?.warning === "string" ? d.warning : "";
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
      return {
        ...next,
        hitl: {
          waitingFor: "source_url",
          reason: "搜索结果无可用 URL，等待用户提供来源链接",
          requestedAt: nowIso(),
          resumePayloadSchema: '{"overrideUrl":"string"}',
        },
      };
    })
    .addNode("auto_filter", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-filter")) return state;
      const startedAtMs = Date.now();
      const s: LearningJobStepRecord = {
        id: "auto-filter",
        phase: "think",
        label: "评估来源并选择优先阅读项（Filter）",
        status: "running",
        at: nowIso(),
      };
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!);

      if (state.hitl?.overrideUrl) {
        const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
        trace.push(`[hitl] overrideUrl=${state.hitl.overrideUrl}`);
        const trust = runNextClawSkill("source_trust", {
          url: state.hitl.overrideUrl,
          title: "人工指定来源",
          snippet: "",
          markdown: "",
        });
        next = updateLastStep(next, {
          status: "done",
          toolSummary: `人工指定来源：${state.hitl.overrideUrl}；trust=${trust.level}/${trust.score}`,
        });
        next = withAgentTrace({
          state: next,
          role: "source_analyst",
          inputSummary: `overrideUrl=${state.hitl.overrideUrl}`,
          outputSummary: "采用人工指定来源，跳过自动筛选",
          handoffTo: "source_analyst",
          startedAtMs,
          candidateCount: 1,
          toolDomain: "web",
        });
        await flushSteps(next.jobId, next.steps!);
        return {
          ...next,
          toolTraceLines: trace,
          autoCandidates: [
            {
              url: state.hitl.overrideUrl,
              title: "人工指定来源",
              description: "",
              trustScore: trust.score,
              trustLevel: trust.level,
            },
          ],
          autoPick: {
            announce: "已采用人工指定来源，跳过自动筛选。",
            selectedUrl: state.hitl.overrideUrl,
          },
        };
      }

      const results = state.autoWebSearchResults?.results ?? [];
      const candidates: CandidateSource[] = results
        .filter((x: { title?: string; url?: string; description?: string }) => typeof x.url === "string" && /^https?:\/\//.test(x.url ?? ""))
        .map((x: { title?: string; url?: string; description?: string }) => {
          const trust = runNextClawSkill("source_trust", {
            url: x.url ?? "",
            title: x.title ?? "",
            snippet: x.description ?? "",
            markdown: "",
          });
          return {
            url: x.url ?? "",
            title: x.title ?? "",
            description: x.description ?? "",
            trustScore: trust.score,
            trustLevel: trust.level,
          };
        })
        .sort((a: CandidateSource, b: CandidateSource) => b.trustScore - a.trustScore)
        .slice(0, Math.max(1, PARALLEL_FETCH_LIMIT));
      const pick = pickBestByHeuristic(results);
      const picked = results.find((x: { url?: string }) => (x.url ?? "").trim() === (pick.selectedUrl ?? "").trim());
      const trust = runNextClawSkill("source_trust", {
        url: pick.selectedUrl,
        title: picked?.title ?? pick.selectedTitle ?? "",
        snippet: picked?.description ?? "",
        markdown: "",
      });

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      trace.push(`[filter] ${pick.announce}`);
      trace.push(`[source_trust] level=${trust.level}; score=${trust.score}`);

      next = updateLastStep(next, {
        status: "done",
        toolSummary: `${pick.announce}；trust=${trust.level}/${trust.score}`,
      });
      const sourceSummary = sourceAnalystAgent.summarizeCandidates({
        query: state.autoWebSearchResults?.query ?? "",
        candidates: candidates.map((x) => ({
          url: x.url,
          title: x.title,
          score: x.trustScore,
          selected: x.url === pick.selectedUrl,
        })),
      });
      next = withAgentTrace({
        state: next,
        role: "source_analyst",
        inputSummary: `query=${state.autoWebSearchResults?.query ?? ""}; results=${results.length}`,
        outputSummary: `${sourceSummary.summary}；${sourceSummary.detail}`,
        handoffTo: "source_analyst",
        startedAtMs,
        candidateCount: candidates.length,
        toolDomain: "web",
      });
      await flushSteps(next.jobId, next.steps!);
      return {
        ...next,
        toolTraceLines: trace,
        autoCandidates: candidates,
        autoPick: { announce: pick.announce, selectedUrl: pick.selectedUrl, selectedTitle: pick.selectedTitle },
      };
    })
    .addNode("auto_fetch", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-fetch")) return state;
      const url = state.autoPick?.selectedUrl ?? "";
      const startedAtMs = Date.now();
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
      const roleStats = next.roleStats ?? createRoleStats();
      roleStats.source_analyst += 1;
      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const candidateInputs =
        (state.autoCandidates?.length ? state.autoCandidates : []).slice(0, Math.max(1, PARALLEL_FETCH_LIMIT));
      const fallbackCandidate =
        candidateInputs.length === 0 && url
          ? [{ url, title: state.autoPick?.selectedTitle, description: "", trustScore: 0, trustLevel: "unknown" }]
          : candidateInputs;

      const fetchResults = await Promise.all(
        fallbackCandidate.map(async (candidate: CandidateSource, index: number) => {
          const r = await callToolWithPolicy({
            jobId: state.jobId,
            role: "source_analyst",
            toolName: "fetch_url",
            ctx: {
              userId: state.userId,
              note: jobNote,
              relatedNotes: state.relatedNotes ?? [],
              toolInput: { url: candidate.url },
              runtime: { channelKey: `fetch:${state.jobId}:${index}` },
            },
            metrics,
            roleStats,
            steps: next.steps ?? [],
            retryStepLabel: "网页抓取暂时失败，按策略自动重试",
          });
          const d = r.data as { markdown?: string; url?: string } | null;
          const markdown = typeof d?.markdown === "string" ? d.markdown : "";
          return {
            candidate,
            result: r,
            url: typeof d?.url === "string" ? d.url : candidate.url,
            markdown,
          };
        }),
      );

      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      for (const row of fetchResults) {
        trace.push(`[fetch_url:${row.candidate.title || row.candidate.url}] ${row.result.summary}`);
      }

      const fetchedCandidates = fetchResults
        .filter((row) => row.result.ok && row.markdown.trim())
        .map((row) => ({
          ...row.candidate,
          url: row.url,
          markdown: row.markdown,
          summary: row.result.summary,
          chars: row.markdown.length,
        }))
        .sort((a, b) => {
          if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
          return b.chars - a.chars;
        });
      const bestFetched = fetchedCandidates[0];

      next = updateLastStep(next, {
        status: bestFetched ? "done" : "failed",
        toolSummary: bestFetched
          ? `并行抓取 ${fetchResults.length} 个候选，采用 ${bestFetched.title || bestFetched.url}（${bestFetched.chars} 字）`
          : fetchResults[0]?.result.summary ?? "fetch_url：未抓取到可用正文",
      });
      next = withAgentTrace({
        state: next,
        role: "source_analyst",
        inputSummary: `candidates=${fallbackCandidate.length}; picked=${state.autoPick?.selectedUrl ?? ""}`,
        outputSummary: bestFetched
          ? `抓取完成，采用 ${bestFetched.title || bestFetched.url}`
          : "候选抓取失败，未得到可用正文",
        handoffTo: bestFetched ? "auditor" : "planner",
        startedAtMs,
        candidateCount: fallbackCandidate.length,
        parallelTasks: fallbackCandidate.length,
        toolDomain: "web",
        communication: fetchedCandidates.map((x) => `${x.title || x.url}:${x.chars}`),
      });
      await flushSteps(next.jobId, next.steps!);

      if (!bestFetched) return { ...next, metrics, roleStats, toolTraceLines: trace, autoFetchedCandidates: [] };
      return {
        ...next,
        metrics,
        roleStats,
        toolTraceLines: trace,
        autoFetchedCandidates: fetchedCandidates,
        autoFetched: { url: bestFetched.url, markdown: bestFetched.markdown },
      };
    })
    .addNode("auto_audit", async (state) => {
      await ensureNotInterrupted(state.jobId);
      if (isDone(state.steps, "auto-audit")) return state;
      const startedAtMs = Date.now();
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
      const roleStats = next.roleStats ?? createRoleStats();
      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];
      const fetchedMarkdown = state.autoFetched?.markdown ?? "";

      const remoteAuditPromise = callToolWithPolicy({
        jobId: state.jobId,
        role: "auditor",
        toolName: "audit_content",
        ctx: {
          userId: state.userId,
          note: jobNote,
          relatedNotes: state.relatedNotes ?? [],
          toolInput: { newContent: fetchedMarkdown },
          runtime: { channelKey: `audit:${state.jobId}` },
        },
        metrics,
        roleStats,
        steps: next.steps ?? [],
      });

      const localAuditPromise = Promise.resolve(
        runNextClawSkill("conflict_audit", {
          noteText: state.noteText ?? "",
          fetchedMarkdown,
          relatedNotes: (state.relatedNotes ?? []).map((n: RelatedNote) => ({
            noteId: n.noteId,
            title: n.title,
            snippet: n.snippet ?? "",
          })),
        }),
      );

      const [r, localAudit] = PARALLEL_AUDIT_ENABLED
        ? await Promise.all([remoteAuditPromise, localAuditPromise])
        : [await remoteAuditPromise, await localAuditPromise];

      trace.push(`[audit_content] ${r.summary}`);
      trace.push(
        `[conflict_audit] conflicts=${localAudit.conflicts.length}; fillGaps=${localAudit.fillGaps.length}; evidence=${localAudit.evidence.length}`,
      );

      const d = (r.data ?? null) as { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] } | null;
      const mergedConflicts = Array.from(new Set([...(d?.conflicts ?? []), ...localAudit.conflicts])).slice(0, 8);
      const mergedFillGaps = Array.from(new Set([...(d?.fillGaps ?? []), ...localAudit.fillGaps])).slice(0, 8);
      const mergedSuggested = Array.isArray(d?.suggestedNoteIds) ? d!.suggestedNoteIds : [];
      const auditSummary = auditorAgent.summarizeAuditCounts({
        conflicts: mergedConflicts,
        fillGaps: mergedFillGaps,
        suggestedNoteIds: mergedSuggested,
      });
      const issues: NextClawAuditIssue[] = [
        ...mergedConflicts.map((message) => ({
          type: "conflict" as const,
          severity: "high" as const,
          message,
          source: "merged" as const,
          confidence: 0.78,
          relatedNoteIds: mergedSuggested,
        })),
        ...mergedFillGaps.map((message) => ({
          type: "missing_context" as const,
          severity: "medium" as const,
          message,
          source: "merged" as const,
          confidence: 0.7,
          relatedNoteIds: mergedSuggested,
        })),
      ];

      next = updateLastStep(next, {
        status: r.ok ? "done" : "failed",
        toolSummary: r.ok
          ? `${r.summary}（conflicts=${auditSummary.conflicts}, fillGaps=${auditSummary.fillGaps}, suggested=${auditSummary.suggested}）`
          : r.summary,
      });
      next = withAgentTrace({
        state: next,
        role: "auditor",
        inputSummary: `fetchedChars=${fetchedMarkdown.length}; related=${state.relatedNotes?.length ?? 0}`,
        outputSummary: `conflicts=${auditSummary.conflicts}; fillGaps=${auditSummary.fillGaps}; suggested=${auditSummary.suggested}`,
        handoffTo: "planner",
        startedAtMs,
        parallelTasks: PARALLEL_AUDIT_ENABLED ? 2 : 1,
        toolDomain: "audit",
        communication: [
          `remote=${r.ok ? "ok" : "fail"}`,
          `local=conflicts:${localAudit.conflicts.length}/fillGaps:${localAudit.fillGaps.length}`,
        ],
      });
      await flushSteps(next.jobId, next.steps!);

      return {
        ...next,
        metrics,
        roleStats,
        toolTraceLines: trace,
        autoAudit: {
          issues,
          suggestedNoteIds: mergedSuggested,
          counts: auditSummary,
        },
      };
    })
    // NOTE: LangGraph 不允许 node name 与 state channel 同名；
    // state 里有 `plan`，因此节点名必须避开（例如 planner_node）。
    .addNode("planner_node", async (state) => {
    await ensureNotInterrupted(state.jobId);
    if (isDone(state.steps, "plan")) return state;
    const startedAtMs = Date.now();

    // capture 来源笔记直接使用合成计划，跳过 AI 规划
    if (state.noteSourceType === "capture") {
      const fallbackPlan = { steps: [{ id: "s1", title: "基于已有上下文生成学习卡片与复习要点", tool: "synthesize" }] };
      const s: LearningJobStepRecord = {
        id: "plan",
        phase: "think",
        label: `${roleLabel("planner")}：生成 JSON 执行计划（Plan-Based）`,
        status: "done",
        at: nowIso(),
        toolSummary: "capture 笔记正文已完整，跳过规划步骤",
      };
      const roleStats = state.roleStats ?? createRoleStats();
      roleStats.planner += 1;
      let next = pushStep(state, s);
      await flushSteps(next.jobId, next.steps!, { plan: fallbackPlan });
      next = withAgentTrace({
        state: next,
        role: "planner",
        inputSummary: "capture 来源正文已完整",
        outputSummary: "跳过 AI 规划，直接使用 synthesize fallback plan",
        handoffTo: "coach",
        startedAtMs,
      });
      await flushSteps(next.jobId, next.steps!, { plan: fallbackPlan });
      return { ...next, plan: fallbackPlan, roleStats, metrics: state.metrics ?? next.metrics, toolTraceLines: state.toolTraceLines ?? next.toolTraceLines };
    }

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
    const roleStats = state.roleStats ?? createRoleStats();
    roleStats.planner += 1;

    const plan = existingPlan
      ? existingPlan
      : await plannerAgent.run({
          noteTitle: state.noteTitle ?? "",
          noteSnippet: state.noteText ?? "",
          relatedLines: state.relatedLines ?? [],
          jobType: state.jobType,
          urls: Array.from((state.noteText ?? "").matchAll(/https?:\/\/[^\s)>\]]+/g))
            .map((m) => m[0])
            .slice(0, 5),
        });

    next = updateLastStep(next, { status: "done", toolSummary: `steps=${plan.steps.length}` });
    next = withAgentTrace({
      state: next,
      role: "planner",
      inputSummary: `related=${state.relatedNotes?.length ?? 0}; autoAudit=${state.autoAudit?.issues.length ?? 0}`,
      outputSummary: `生成 ${plan.steps.length} 个计划步骤`,
      handoffTo: "retriever",
      startedAtMs,
      communication: plan.steps.slice(0, 6).map((step: { id: string; tool: string | null }) => `${step.id}:${step.tool ?? "noop"}`),
    });
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
      const roleStats = next.roleStats ?? createRoleStats();
      const trace = Array.isArray(next.toolTraceLines) ? next.toolTraceLines : [];

      const jobNote = { id: state.noteId, title: state.noteTitle ?? "", content: state.noteHtml ?? "" };
      const defaultUrl =
        state.hitl?.overrideUrl ||
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

        const planToolInput = asPlanToolInput(ps.toolInput);

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

        // capture 来源的笔记已包含完整正文，跳过重复 fetch_url
        if (tool === "fetch_url" && state.noteSourceType === "capture" && (state.noteText?.length ?? 0) >= 2000) {
          next.steps = next.steps ?? [];
          next.steps.push({
            id: ps.id,
            phase: "done",
            label: `${ps.title}（capture 笔记已含正文，跳过）`,
            status: "done",
            toolName: "fetch_url",
            at: nowIso(),
            toolSummary: "笔记来源为 capture，正文已存在，无需重复抓取",
          });
          await flushSteps(next.jobId, next.steps);
          skipped += 1;
          continue;
        }

        // HITL：若计划执行遇到 fetch_url 但仍然没有可用 url，则进入等待用户提供来源
        if (tool === "fetch_url" && typeof toolInput?.url === "string" && !toolInput.url.trim()) {
          next = updateLastStep(next, {
            status: "done",
            toolSummary: "缺少可用 URL：需要你提供一个来源链接后才能继续（HITL）",
          });
          await flushSteps(next.jobId, next.steps!);
          return {
            ...next,
            hitl: {
              waitingFor: "source_url",
              reason: "计划执行需要来源 URL，但当前没有可用链接",
              requestedAt: nowIso(),
              resumePayloadSchema: '{"overrideUrl":"string"}',
            },
          };
        }

        const r = await callToolWithPolicy({
          jobId: state.jobId,
          role,
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
    const startedAtMs = Date.now();

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

    const roleStats = state.roleStats ?? createRoleStats();
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

    const cards = Array.isArray(lite.cards) ? [...lite.cards] : [];
    let reviewEnhanced = 0;
    let antiCopyPassed = 0;
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i] as PersistCard | undefined;
      if (!c || c.type !== "REVIEW") continue;
      const rq = runNextClawSkill("review_question", {
        cardTitle: c.title ?? "",
        noteText: state.noteText ?? "",
        keyPoints: [],
      });
      reviewEnhanced += 1;
      if (rq.antiCopyCheck.passed) antiCopyPassed += 1;
      const addon = [
        "## 自测问题",
        `- ${rq.question}`,
        "## 参考答案要点",
        ...rq.answerKeyPoints.map((x) => `- ${x.replace(/^\d+\.\s*/, "")}`),
      ].join("\n");
      const hasReviewSection = /自测问题|参考答案要点/.test(c.contentMd ?? "");
      cards[i] = {
        type: c.type ?? "REVIEW",
        title: c.title ?? "",
        contentMd: hasReviewSection ? (c.contentMd ?? "") : `${c.contentMd ?? ""}\n\n${addon}`.trim(),
        sources: c.sources,
      };
    }

    const liteWithReview = { ...lite, cards };
    next = updateLastStep(next, {
      status: "done",
      toolSummary: `cards=${cards.length}; reviewEnhanced=${reviewEnhanced}; antiCopyPass=${antiCopyPassed}/${reviewEnhanced || 0}`,
    });
    next = withAgentTrace({
      state: next,
      role: "coach",
      inputSummary: `related=${state.relatedNotes?.length ?? 0}; traceLines=${toolTraceLines.length}`,
      outputSummary: `产出 cards=${cards.length}; reviewEnhanced=${reviewEnhanced}`,
      handoffTo: "scheduler",
      startedAtMs,
      communication: cards.slice(0, 4).map((card) => `${card.type}:${card.title}`),
    });
    await flushSteps(next.jobId, next.steps!);

    return { ...next, roleStats, toolTraceLines, coachResult: liteWithReview, metrics: state.metrics ?? next.metrics };
  })
    .addNode("persist", async (state: NextClawLangGraphState & { coachResult?: { cards?: PersistCard[] } }) => {
    await ensureNotInterrupted(state.jobId);
    if (isDone(state.steps, "persist")) return state;
    const startedAtMs = Date.now();

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
    const cards = Array.isArray(lite?.cards) ? [...lite.cards] : [];

    // 如果 autonomous audit 有结果，插入一张审计卡（让用户明确看到 agent 的“对账过程”）
    const audit = state.autoAudit;
    if (audit && cards.length) {
      const conflicts = audit.issues.filter((x) => x.type === "conflict").map((x) => x.message).slice(0, 6);
      const fillGaps = audit.issues.filter((x) => x.type === "missing_context").map((x) => x.message).slice(0, 6);
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
        fillGaps.length ? "## 查漏补缺点" : null,
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
        contentMd: md || "（审计完成：未发现明显冲突或查漏补缺点）",
        sources: { suggestedNoteIds: suggestIds },
      });
    }

    let guardPassed = 0;
    let guardFailed = 0;
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i] as PersistCard | undefined;
      if (!c) continue;
      const g = runNextClawSkill("card_quality_guard", {
        type: c.type ?? "FILL_GAP",
        title: c.title ?? "",
        contentMd: c.contentMd ?? "",
      });
      if (g.passed) {
        guardPassed += 1;
      } else {
        guardFailed += 1;
        if (g.suggestions.length) {
          cards[i] = {
            ...c,
            contentMd: `${c.contentMd ?? ""}\n\n## 质量改进建议\n${g.suggestions.map((x) => `- ${x}`).join("\n")}`.trim(),
          };
        }
      }
    }

    await prisma.learningCard.deleteMany({
      where: { userId: state.userId, noteId: job.noteId, noteUpdatedAt: job.noteUpdatedAt ?? undefined },
    });

    const cardNoteId = job.noteId!;
    await prisma.learningCard.createMany({
      data: cards.map((c: PersistCard) => ({
        userId: state.userId,
        noteId: cardNoteId,
        type: c.type,
        title: c.title,
        contentMd: c.contentMd,
        sources: c.sources ?? {
          relatedNotes: (state.relatedNotes ?? []).map((n) => ({ noteId: n.noteId, title: n.title, distance: n.distance })),
        },
        noteUpdatedAt: job.noteUpdatedAt ?? note.updatedAt,
      })),
    });

    const roleStats = state.roleStats ?? createRoleStats();
    roleStats.scheduler += 1;
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.reviewItem.upsert({
      where: { userId_noteId: { userId: state.userId, noteId: job.noteId } },
      create: { userId: state.userId, noteId: job.noteId, dueDate, intervalDays: 1, easeFactor: 2.5 },
      update: { dueDate },
    });

    next = updateLastStep(
      next,
      { status: "done", toolSummary: `cards=${cards.length}; qualityPass=${guardPassed}; qualityFail=${guardFailed}` },
    );
    next = withAgentTrace({
      state: next,
      role: "scheduler",
      inputSummary: `cards=${cards.length}; auditIssues=${state.autoAudit?.issues.length ?? 0}`,
      outputSummary: `已落库 cards=${cards.length}; qualityFail=${guardFailed}`,
      handoffTo: "end",
      startedAtMs,
      communication: [`reviewDue=${dueDate.toISOString()}`],
    });
    await flushSteps(next.jobId, next.steps!);

    return { ...next, roleStats, metrics: state.metrics ?? next.metrics, toolTraceLines: state.toolTraceLines ?? next.toolTraceLines };
  })
    .addNode("finalize", async (state) => {
    if (isDone(state.steps, "evaluation") || isDone(state.steps, "evaluation-failed")) return state;
    const metrics = state.metrics ?? createExecutionMetrics();
    const evaluation = toEvaluationSummary(metrics);

    const roleStats = state.roleStats ?? createRoleStats();

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
    .addEdge("load_and_retrieve", "supervisor")
    .addConditionalEdges(
      "supervisor",
      (s) => {
        if (s.supervisorDecision?.route === "direct_plan") return "plan";
        if (s.supervisorDecision?.route === "retrieve_and_search") return "reason";
        return "reason";
      },
      {
        plan: "planner_node",
        reason: "auto_reason",
      },
    )
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
      (s) => (s.hitl?.waitingFor === "source_url" ? "need_url" : "go"),
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

  const threadConfig: CheckpointConfig = { configurable: { thread_id: params.jobId } };
  // 尝试从 checkpointer 读取最近一次 checkpoint（若存在，则在同 thread 上继续）。
  // 这会让 resume 更接近“真正恢复”而不是完全重跑。
  try {
    const resumableCheckpointer = checkpointer as CheckpointerWithTuple;
    if (typeof resumableCheckpointer.getTuple === "function") {
      const tuple = await resumableCheckpointer.getTuple(threadConfig);
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
          noteSourceType: resumed.noteSourceType,
          relatedNotes: resumed.relatedNotes,
          relatedLines: resumed.relatedLines,
          kbDigest: resumed.kbDigest,
          plan: resumed.plan,
          metrics: resumed.metrics ?? createExecutionMetrics(),
          toolTraceLines: resumed.toolTraceLines ?? [],
          roleStats: resumed.roleStats ?? createRoleStats(),
          steps: Array.isArray(resumed.steps) ? resumed.steps : [],
          coachResult: resumed.coachResult,
          supervisorDecision: resumed.supervisorDecision,
          autoDecision: resumed.autoDecision,
          autoWebSearchResults: resumed.autoWebSearchResults,
          autoCandidates: resumed.autoCandidates,
          autoPick: resumed.autoPick,
          autoFetchedCandidates: resumed.autoFetchedCandidates,
          autoFetched: resumed.autoFetched,
          autoAudit: resumed.autoAudit,
          hitl: resumed.hitl
            ? {
                ...resumed.hitl,
                resumedFromCheckpointId: ckptConfig?.checkpoint_id ?? undefined,
                resumeReason: resumed.hitl.overrideUrl ? "用户提供了来源 URL 后恢复执行" : "从 checkpoint 自动恢复",
                humanInputSnapshot: resumed.hitl.overrideUrl
                  ? `用户指定 URL: ${resumed.hitl.overrideUrl.slice(0, 180)}`
                  : undefined,
                resumePayloadSchema: resumed.hitl.resumePayloadSchema ?? '{"overrideUrl":"string"}',
              }
            : undefined,
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
            data: { status: "FAILED", finishedAt: new Date(), lastError: msg, steps },
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
    noteSourceType: undefined,
    relatedNotes: undefined,
    relatedLines: undefined,
    kbDigest: undefined,
    plan: undefined,
    metrics: createExecutionMetrics(),
    toolTraceLines: [],
    roleStats: createRoleStats(),
    steps: [],
    coachResult: undefined,
    supervisorDecision: undefined,
    autoDecision: undefined,
    autoWebSearchResults: undefined,
    autoCandidates: undefined,
    autoPick: undefined,
    autoFetchedCandidates: undefined,
    autoFetched: undefined,
    autoAudit: undefined,
    hitl: undefined,
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
      data: { status: "FAILED", finishedAt: new Date(), lastError: msg, steps },
    });
  }
}

