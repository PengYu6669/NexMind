import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";
import { MAX_PLAN_STEPS } from "@/lib/nextclaw-agent-config";
import type { LearningJobType } from "@prisma/client";
import type { LearningPlanJson, LearningPlanStepDraft, PlanToolName } from "@/lib/nextclaw-agent-types";

/** Retriever 节点已做过 RAG 与笔记加载，Fallback 只进入合成，避免重复工具与耗时 */
const FALLBACK_PLAN: LearningPlanJson = {
  steps: [{ id: "s1", title: "基于已有上下文生成学习卡片与复习要点", tool: "synthesize" }],
};

function normalizeTool(v: unknown): PlanToolName | null {
  const s = String(v ?? "").trim();
  if (
    s === "search_notes" ||
    s === "read_note" ||
    s === "web_search" ||
    s === "fetch_url" ||
    s === "audit_content" ||
    s === "synthesize" ||
    s === "noop"
  )
    return s;
  if (!s || s === "null") return null;
  return "noop";
}

function normalizePlan(raw: unknown): LearningPlanJson | null {
  if (!raw || typeof raw !== "object") return null;
  const steps = (raw as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const out: LearningPlanStepDraft[] = [];
  for (let i = 0; i < steps.length; i++) {
    const row = steps[i];
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; title?: unknown; tool?: unknown; toolInput?: unknown };
    const id = String(r.id ?? "").trim() || `step-${i + 1}`;
    const title = String(r.title ?? "").trim();
    if (!title) continue;
    const tool = normalizeTool(r.tool);
    const toolInput =
      r.toolInput && typeof r.toolInput === "object" && !Array.isArray(r.toolInput)
        ? (r.toolInput as Record<string, unknown>)
        : undefined;
    out.push({ id, title, tool, ...(toolInput ? { toolInput } : {}) });
  }
  return out.length ? { steps: out.slice(0, MAX_PLAN_STEPS) } : null;
}

function capPlanSteps(plan: LearningPlanJson): LearningPlanJson {
  return { steps: plan.steps.slice(0, MAX_PLAN_STEPS) };
}

/**
 * 基于当前笔记与检索摘要，让 LLM 输出 JSON Plan（steps + 建议 tool）。
 * 失败时返回内置 Fallback，保证 Runner 可继续执行。
 */
export async function generateLearningPlan(params: {
  noteTitle: string;
  noteSnippet: string;
  relatedLines: string[];
  jobType: LearningJobType;
  urls?: string[];
}): Promise<LearningPlanJson> {
  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const deep = params.jobType === "NOTE_LEARN_DEEP";
  const system =
    "你是 NextClaw 学习任务规划器。根据用户笔记与相关摘要，输出**仅 JSON**（不要 Markdown、不要解释）。\n" +
    "重要：同一任务里 **Retriever 节点已经完成** 相关笔记检索与当前笔记加载；除非确实需要「换关键词再搜」「精读另一篇笔记 id」或「外链抓取/审计」，否则不要重复安排 search_notes / read_note，优先用 noop 推理或直接进入 synthesize，以减少冗余耗时。\n" +
    "字段：steps 为数组；每项含 id（短字符串）、title（中文短句，说明该步做什么）、tool（可为 null 或以下之一：search_notes | read_note | web_search | fetch_url | audit_content | synthesize | noop）、toolInput（可选对象，用于工具参数）。\n" +
    "约束：" +
    (deep ? "steps 数量 4～8" : "steps 数量 2～5（能少则少，仍以质量为先）") +
    "；必须包含至少一步 synthesize 用于最终生成学习卡片；search_notes 表示依赖检索结果，read_note 表示需要精读正文，noop 表示纯推理不写工具。\n" +
    "工具说明：web_search=联网搜索并返回候选链接；fetch_url=抓取网页并转为 Markdown；audit_content=把抓取内容与相关笔记做审计对比，产出冲突/补位/关联建议。\n" +
    "toolInput 约定（尽量填写）：\n" +
    "- web_search: { query: string, topK?: number }\n" +
    "- read_note: { noteId?: string }（省略表示读当前笔记）\n" +
    "- fetch_url: { url: \"$best_url\" }\n" +
    "- audit_content: { newContent: \"$fetched_markdown\" }\n" +
    (deep ? "深度模式：允许更多 compare/推理步骤（仍用 noop 表示无工具）。\n" : "");

  const user = JSON.stringify({
    noteTitle: params.noteTitle,
    noteSnippet: params.noteSnippet.slice(0, 4000),
    relatedSummaries: params.relatedLines.slice(0, 8),
    urls: (params.urls ?? []).slice(0, 5),
  });

  try {
    const raw = await callDashscopeChatCompletion({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = extractJsonFromText(raw);
    const plan = normalizePlan(parsed);
    if (plan?.steps?.length) {
      const hasSynth = plan.steps.some((s) => s.tool === "synthesize");
      if (!hasSynth) {
        plan.steps.push({
          id: "finalize",
          title: "生成结构化学习卡片与复习要点",
          tool: "synthesize",
        });
      }
      return capPlanSteps(plan);
    }
  } catch (e) {
    console.warn("[nextclaw-learning-plan] LLM plan failed, using fallback", e);
  }

  return capPlanSteps(FALLBACK_PLAN);
}
