import type { PlanToolName } from "@/lib/nextclaw-agent-types";

type ToolResultLike = { ok: boolean; summary: string };

export type NextClawExecutionMetrics = {
  startedAtMs: number;
  toolCalls: number;
  retries: number;
  degraded: boolean;
  needHumanIntervention: boolean;
};

export function createExecutionMetrics(): NextClawExecutionMetrics {
  return {
    startedAtMs: Date.now(),
    toolCalls: 0,
    retries: 0,
    degraded: false,
    needHumanIntervention: false,
  };
}

export function shouldRetryTool(toolName: PlanToolName, attempt: number, result: ToolResultLike): boolean {
  if (result.ok) return false;
  if (attempt >= 2) return false;
  const summary = result.summary.toLowerCase();
  const retryableSignals = ["fetch failed", "timeout", "网络", "temporarily", "429", "rate limit"];
  const retryable = retryableSignals.some((x) => summary.includes(x));
  // 关键 I/O 工具允许有限重试；内容审计失败通常为输入问题，不无限重试
  if (toolName === "fetch_url" || toolName === "web_search" || toolName === "read_note") return retryable;
  return false;
}

export function markToolFailureEffect(
  toolName: PlanToolName,
  result: ToolResultLike,
  metrics: NextClawExecutionMetrics,
) {
  if (result.ok) return;
  // 非核心步骤失败允许降级继续，避免整单失败
  if (toolName === "web_search" || toolName === "fetch_url" || toolName === "audit_content") {
    metrics.degraded = true;
    return;
  }
  metrics.needHumanIntervention = true;
}

export function toEvaluationSummary(metrics: NextClawExecutionMetrics) {
  return {
    toolCalls: metrics.toolCalls,
    retries: metrics.retries,
    degraded: metrics.degraded,
    needHumanIntervention: metrics.needHumanIntervention,
    durationMs: Date.now() - metrics.startedAtMs,
  };
}
