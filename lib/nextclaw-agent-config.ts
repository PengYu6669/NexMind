/**
 * NextClaw 自治 Agent 可调参数（环境变量覆盖，便于线上调优）。
 */

export type ParameterEvidence =
  | "heuristic_default"
  | "latency_guardrail"
  | "cost_guardrail"
  | "feature_gate";

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

type TunableIntSetting = {
  key: string;
  value: number;
  evidence: ParameterEvidence;
  rationale: string;
};

type TunableBoolSetting = {
  key: string;
  value: boolean;
  evidence: ParameterEvidence;
  rationale: string;
};

export const NEXTCLAW_TUNABLES = {
  ragTopKLite: {
    key: "NEXTCLAW_RAG_TOPK_LITE",
    value: intEnv("NEXTCLAW_RAG_TOPK_LITE", 5),
    evidence: "heuristic_default",
    rationale: "轻量学习优先控制上下文体积与响应延迟，默认取较小召回数。",
  } satisfies TunableIntSetting,
  ragTopKDeep: {
    key: "NEXTCLAW_RAG_TOPK_DEEP",
    value: intEnv("NEXTCLAW_RAG_TOPK_DEEP", 8),
    evidence: "heuristic_default",
    rationale: "深度学习允许更广上下文，默认取更高召回上限。",
  } satisfies TunableIntSetting,
  maxPlanSteps: {
    key: "NEXTCLAW_MAX_PLAN_STEPS",
    value: intEnv("NEXTCLAW_MAX_PLAN_STEPS", 10),
    evidence: "latency_guardrail",
    rationale: "防止 Planner 输出过长计划导致时延和 token 开销膨胀。",
  } satisfies TunableIntSetting,
  autonomousMaxRounds: {
    key: "NEXTCLAW_AUTONOMOUS_MAX_ROUNDS",
    value: intEnv("NEXTCLAW_AUTONOMOUS_MAX_ROUNDS", 1),
    evidence: "feature_gate",
    rationale: "当前仅允许单轮自治，避免递归式补源和状态爆炸。",
  } satisfies TunableIntSetting,
  parallelFetchLimit: {
    key: "NEXTCLAW_PARALLEL_FETCH_LIMIT",
    value: intEnv("NEXTCLAW_PARALLEL_FETCH_LIMIT", 2),
    evidence: "latency_guardrail",
    rationale: "候选来源抓取使用受控并行，避免单任务外部 I/O 放大到不可控范围。",
  } satisfies TunableIntSetting,
  parallelAuditEnabled: {
    key: "NEXTCLAW_PARALLEL_AUDIT_ENABLED",
    value: boolEnv("NEXTCLAW_PARALLEL_AUDIT_ENABLED", true),
    evidence: "feature_gate",
    rationale: "允许远程审计与本地审计并行执行，用于提升深度学习任务吞吐。",
  } satisfies TunableBoolSetting,
  searchPreferCn: {
    key: "NEXTCLAW_SEARCH_PREFER_CN",
    value: boolEnv("NEXTCLAW_SEARCH_PREFER_CN", true),
    evidence: "heuristic_default",
    rationale: "默认更偏向中文可访问来源，贴近当前用户环境。",
  } satisfies TunableBoolSetting,
  searchCnOnly: {
    key: "NEXTCLAW_SEARCH_CN_ONLY",
    value: boolEnv("NEXTCLAW_SEARCH_CN_ONLY", false),
    evidence: "feature_gate",
    rationale: "仅在受限网络或强本地化场景下开启中国域名限定。",
  } satisfies TunableBoolSetting,
  conversationMaxTokens: {
    key: "NEXTCLAW_CONVERSATION_MAX_TOKENS",
    value: intEnv("NEXTCLAW_CONVERSATION_MAX_TOKENS", 4000),
    evidence: "heuristic_default",
    rationale: "对话历史窗口的 token 预算，超出部分压缩为摘要而非直接丢弃。",
  } satisfies TunableIntSetting,
  conversationKeepRecent: {
    key: "NEXTCLAW_CONVERSATION_KEEP_RECENT",
    value: intEnv("NEXTCLAW_CONVERSATION_KEEP_RECENT", 8),
    evidence: "heuristic_default",
    rationale: "最近保留原文的对话条数，确保模型能感知最新对话细节。",
  } satisfies TunableIntSetting,
  supervisorLLMRouting: {
    key: "NEXTCLAW_SUPERVISOR_LLM_ROUTING",
    value: boolEnv("NEXTCLAW_SUPERVISOR_LLM_ROUTING", false),
    evidence: "feature_gate",
    rationale: "Supervisor 路由是否使用 LLM 替代纯规则（默认关闭，开启后 +1 次 LLM 调用）。",
  } satisfies TunableBoolSetting,
  chunkSizeNote: {
    key: "NEXTCLAW_CHUNK_SIZE_NOTE",
    value: intEnv("NEXTCLAW_CHUNK_SIZE_NOTE", 700),
    evidence: "heuristic_default",
    rationale: "Markdown/笔记文档的分块大小。",
  } satisfies TunableIntSetting,
  chunkSizeLongform: {
    key: "NEXTCLAW_CHUNK_SIZE_LONGFORM",
    value: intEnv("NEXTCLAW_CHUNK_SIZE_LONGFORM", 1000),
    evidence: "heuristic_default",
    rationale: "PDF/长文等连续文本的分块大小，适当放大以减少碎片化。",
  } satisfies TunableIntSetting,
  chunkSizeCode: {
    key: "NEXTCLAW_CHUNK_SIZE_CODE",
    value: intEnv("NEXTCLAW_CHUNK_SIZE_CODE", 2000),
    evidence: "heuristic_default",
    rationale: "代码库/技术文档的分块大小，尽量不切函数/类。",
  } satisfies TunableIntSetting,
  chunkSizeConversation: {
    key: "NEXTCLAW_CHUNK_SIZE_CONVERSATION",
    value: intEnv("NEXTCLAW_CHUNK_SIZE_CONVERSATION", 400),
    evidence: "heuristic_default",
    rationale: "对话记录的分块大小，单轮对话通常较短。",
  } satisfies TunableIntSetting,
} as const;

/** RAG 命中条数：轻量学习 */
export const RAG_TOPK_LITE = NEXTCLAW_TUNABLES.ragTopKLite.value;

/** RAG 命中条数：深度学习（更广上下文） */
export const RAG_TOPK_DEEP = NEXTCLAW_TUNABLES.ragTopKDeep.value;

/** LLM Plan 最多步数（含 synthesize），防止计划膨胀 */
export const MAX_PLAN_STEPS = NEXTCLAW_TUNABLES.maxPlanSteps.value;

/** 自主学习循环：最多轮次（避免递归爆炸） */
export const AUTONOMOUS_MAX_ROUNDS = NEXTCLAW_TUNABLES.autonomousMaxRounds.value;

/** 候选来源并行抓取上限 */
export const PARALLEL_FETCH_LIMIT = NEXTCLAW_TUNABLES.parallelFetchLimit.value;

/** 审计是否启用并行执行 */
export const PARALLEL_AUDIT_ENABLED = NEXTCLAW_TUNABLES.parallelAuditEnabled.value;

/** 搜索结果偏向中文/中国地区（gl=cn、hl=zh-CN） */
export const SEARCH_PREFER_CN = NEXTCLAW_TUNABLES.searchPreferCn.value;

/** 强制只检索中国域名（在 query 中追加 site:.cn） */
export const SEARCH_CN_ONLY = NEXTCLAW_TUNABLES.searchCnOnly.value;

/** 对话历史窗口 token 预算上限 */
export const CONVERSATION_MAX_TOKENS = NEXTCLAW_TUNABLES.conversationMaxTokens.value;

/** 对话历史窗口最近保留原文的条数 */
export const CONVERSATION_KEEP_RECENT = NEXTCLAW_TUNABLES.conversationKeepRecent.value;

/** Supervisor 是否使用 LLM 路由（默认关闭，开启后 +1 次轻量 LLM 调用） */
export const SUPERVISOR_LLM_ROUTING = NEXTCLAW_TUNABLES.supervisorLLMRouting.value;

/** 笔记/Markdown 文档分块大小 */
export const CHUNK_SIZE_NOTE = NEXTCLAW_TUNABLES.chunkSizeNote.value;

/** 长文/PDF 文档分块大小 */
export const CHUNK_SIZE_LONGFORM = NEXTCLAW_TUNABLES.chunkSizeLongform.value;

/** 代码/技术文档分块大小 */
export const CHUNK_SIZE_CODE = NEXTCLAW_TUNABLES.chunkSizeCode.value;

/** 对话记录分块大小 */
export const CHUNK_SIZE_CONVERSATION = NEXTCLAW_TUNABLES.chunkSizeConversation.value;
