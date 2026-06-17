/**
 * NextClaw 学习任务：Plan + 多步骤状态（与 learning_jobs.plan / steps JSON 对齐）
 */

export type PlanToolName =
  | "search_notes"
  | "read_note"
  | "web_search"
  | "fetch_url"
  | "audit_content"
  | "synthesize"
  | "noop";

export type LearningPlanStepDraft = {
  id: string;
  title: string;
  /** LLM 建议的工具；synthesize 表示进入生成卡片阶段 */
  tool: PlanToolName | null;
  /**
   * 可选：工具参数（由 Planner 直接给出），用于减少 Executor 的兜底逻辑。
   * 例如：
   * - read_note: { noteId }
   * - web_search: { query, topK }
   * - fetch_url: { url: "$best_url" }
   * - audit_content: { newContent: "$fetched_markdown" }
   */
  toolInput?: Record<string, unknown>;
};

export type LearningPlanJson = {
  steps: LearningPlanStepDraft[];
};

export type LearningJobStepStatus = "pending" | "running" | "done" | "failed";

export type LearningJobStepRecord = {
  id: string;
  /** 与 UI 状态机对齐：idle=未开始 think=思考 tool=工具 done=完成 */
  phase: "idle" | "think" | "tool" | "done";
  /** 给用户看的一句话（短） */
  label: string;
  status: LearningJobStepStatus;
  /** 工具友好名（可选） */
  toolName?: string;
  /** 工具结果一句话摘要（可选） */
  toolSummary?: string;
  /** Agent 通信 / 路由 / 时延等结构化元数据 */
  meta?: {
    agentRole?:
      | "supervisor"
      | "planner"
      | "retriever"
      | "source_analyst"
      | "auditor"
      | "coach"
      | "scheduler";
    inputSummary?: string;
    outputSummary?: string;
    handoffTo?:
      | "supervisor"
      | "planner"
      | "retriever"
      | "source_analyst"
      | "auditor"
      | "coach"
      | "scheduler"
      | "end";
    durationMs?: number;
    candidateCount?: number;
    parallelTasks?: number;
    toolDomain?: "knowledge" | "web" | "audit" | "local";
    communication?: string[];
  };
  at: string;
};

export type AuditIssueType =
  | "conflict"
  | "missing_context"
  | "outdated_info"
  | "suggested_link";

export type AuditIssueSeverity = "low" | "medium" | "high";

export type NextClawAuditIssue = {
  type: AuditIssueType;
  severity: AuditIssueSeverity;
  message: string;
  evidence?: string[];
  source: "mcp" | "local_skill" | "merged";
  confidence?: number;
  relatedNoteIds?: string[];
};

export type NextClawAuditSummary = {
  issues: NextClawAuditIssue[];
  suggestedNoteIds: string[];
  counts: {
    conflicts: number;
    fillGaps: number;
    suggested: number;
  };
};

export type NextClawHitlState = {
  waitingFor: "source_url";
  reason: string;
  requestedAt: string;
  overrideUrl?: string;
  resumedAt?: string;
  /** 用户/系统触发恢复的原因 */
  resumeReason?: string;
  /** 恢复时 payload 的 JSON Schema 描述（固定为 {"overrideUrl":"string"}） */
  resumePayloadSchema?: string;
  /** LangGraph checkpoint ID，恢复时从 checkpointer 读取 */
  resumedFromCheckpointId?: string;
  /** 用户输入摘要（截断到 200 字） */
  humanInputSnapshot?: string;
};

// ─── State Contract 拆分 ───────────────────────────────────────────
// 将 NextClawLangGraphState 按职责拆为 5 个逻辑子状态。
// 每个子状态标注：生产者（谁写入）、可修改者、只读消费者。
// 这些类型用于文档、调试和未来重构参考，不改变运行时 state 结构。

/** 文档态 — 生产者: load_and_retrieve — 可修改: load_and_retrieve — 其余节点只读 */
export type DocumentSubState = {
  noteTitle: string | undefined;
  noteHtml: string | undefined;
  noteText: string | undefined;
  noteSourceType: string | undefined;
  relatedNotes: Array<{ noteId: string; title: string; snippet: string; distance?: number }> | undefined;
  relatedLines: string[] | undefined;
  kbDigest: string | undefined;
};

/** 检索态 — 生产者: supervisor / auto_reason / auto_web_search / auto_filter / auto_fetch — 可修改: 对应 auto_* 节点 — planner 只读消费 */
export type RetrievalSubState = {
  supervisorDecision: { route: "direct_plan" | "retrieve_and_search" | "retrieve_only"; reason: string } | undefined;
  autoDecision: { needSearch: boolean; query?: string; reason?: string } | undefined;
  autoWebSearchResults: { query: string; results: Array<{ title?: string; url?: string; description?: string }> } | undefined;
  autoCandidates: Array<{ url: string; title?: string; description?: string; trustScore: number; trustLevel: string }> | undefined;
  autoPick: { announce: string; selectedUrl: string; selectedTitle?: string } | undefined;
  autoFetchedCandidates: Array<{ url: string; title?: string; description?: string; trustScore: number; trustLevel: string; markdown: string; summary: string; chars: number }> | undefined;
  autoFetched: { url: string; markdown: string } | undefined;
};

/** 计划态 — 生产者: planner_node / plan_executor — 其余只读 */
export type PlanSubState = {
  plan: { steps: Array<{ id: string; title: string; tool: string | null }> } | undefined;
  toolTraceLines: string[] | undefined;
};

/** 审计态 — 生产者: auto_audit — planner / coach 只读消费 */
export type AuditSubState = {
  autoAudit: NextClawAuditSummary | undefined;
};

/** 运行时态 — 生产者: graph runner（初始化 + checkpoint 恢复）— 所有节点可读 — 部分字段各节点可追加（steps / metrics） */
export type RuntimeSubState = {
  jobId: string;
  userId: string;
  noteId: string;
  jobType: string;
  roleStats: Record<string, number> | undefined;
  metrics: object | undefined;
  steps: LearningJobStepRecord[] | undefined;
  hitl: NextClawHitlState | undefined;
  coachResult: unknown | undefined;
};

/** State 字段所有权映射表：key → { producer, writers, readers } */
export const NEXTCLAW_STATE_OWNERSHIP: Record<
  string,
  { producer: string; writers: string[]; readers: string[] }
> = {
  // 文档态
  noteTitle:        { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  noteHtml:         { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  noteText:         { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  noteSourceType:   { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  relatedNotes:     { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  relatedLines:     { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  kbDigest:         { producer: "load_and_retrieve", writers: ["load_and_retrieve"], readers: ["*"] },
  // 检索态
  supervisorDecision:     { producer: "supervisor",       writers: ["supervisor"],              readers: ["auto_reason", "auto_filter", "planner_node"] },
  autoDecision:           { producer: "auto_reason",      writers: ["auto_reason"],             readers: ["auto_web_search"] },
  autoWebSearchResults:   { producer: "auto_web_search",  writers: ["auto_web_search"],         readers: ["auto_filter"] },
  autoCandidates:         { producer: "auto_filter",      writers: ["auto_filter"],             readers: ["auto_fetch"] },
  autoPick:               { producer: "auto_filter",      writers: ["auto_filter"],             readers: ["auto_fetch"] },
  autoFetchedCandidates:  { producer: "auto_fetch",       writers: ["auto_fetch"],              readers: ["auditor"] },
  autoFetched:            { producer: "auto_fetch",       writers: ["auto_fetch"],              readers: ["auditor"] },
  // 计划态
  plan:             { producer: "planner_node",  writers: ["planner_node", "plan_executor"], readers: ["plan_executor", "coach"] },
  toolTraceLines:   { producer: "plan_executor", writers: ["plan_executor"],                  readers: ["*"] },
  // 审计态
  autoAudit:        { producer: "auto_audit",    writers: ["auto_audit"],                     readers: ["planner_node", "coach"] },
  // 运行时态
  jobId:            { producer: "graph_runner",  writers: [],                  readers: ["*"] },
  userId:           { producer: "graph_runner",  writers: [],                  readers: ["*"] },
  noteId:           { producer: "graph_runner",  writers: [],                  readers: ["*"] },
  jobType:          { producer: "graph_runner",  writers: [],                  readers: ["*"] },
  roleStats:        { producer: "graph_runner",  writers: ["*"],               readers: ["finalize"] },
  metrics:          { producer: "graph_runner",  writers: ["*"],               readers: ["finalize"] },
  steps:            { producer: "graph_runner",  writers: ["*"],               readers: ["*"] },
  hitl:             { producer: "graph_runner",  writers: ["auto_web_search", "load_and_retrieve"], readers: ["auto_filter", "persist"] },
  coachResult:      { producer: "coach",         writers: ["coach"],           readers: ["persist", "finalize"] },
};
