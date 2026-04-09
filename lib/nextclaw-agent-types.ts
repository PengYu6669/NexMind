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
  at: string;
};
