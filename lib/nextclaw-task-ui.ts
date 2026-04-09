import type { LearningJobStatus } from "@prisma/client";
import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";

function parseSteps(raw: unknown): LearningJobStepRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LearningJobStepRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as LearningJobStepRecord;
    if (typeof r.id !== "string" || typeof r.label !== "string" || typeof r.at !== "string") continue;
    out.push(r);
  }
  return out;
}

export type TaskUiPayload = {
  headline: string;
  /** 0～1 */
  progress: number;
  currentStepLabel: string | null;
  steps: LearningJobStepRecord[];
};

/**
 * 由 learning_jobs.steps + status 推导任务台展示用进度（默认展示当前一步，展开用 steps 全量）。
 */
export function buildTaskUiPayload(params: {
  status: LearningJobStatus;
  steps: unknown;
}): TaskUiPayload {
  const steps = parseSteps(params.steps);
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const running = steps.find((s) => s.status === "running");
  const failed = steps.find((s) => s.status === "failed");

  let headline = "排队中";
  let progress = 0;
  let currentStepLabel: string | null = null;

  if (params.status === "PENDING") {
    headline = "排队中";
    progress = 0.05;
  } else if (params.status === "RUNNING") {
    headline = running ? "执行中" : "执行中";
    currentStepLabel = running?.label ?? (total ? `已完成 ${done}/${total} 步` : "初始化…");
    if (total === 0) progress = 0.1;
    else if (running) progress = Math.min(0.95, (done + 0.35) / total);
    else progress = Math.min(0.92, done / Math.max(1, total));
  } else if (params.status === "SUCCEEDED") {
    headline = "已完成";
    progress = 1;
    currentStepLabel = steps.length ? steps[steps.length - 1]?.label ?? null : null;
  } else if (params.status === "FAILED") {
    headline = failed ? `失败：${failed.label}` : "失败";
    progress = total ? Math.min(0.9, done / Math.max(1, total)) : 0.2;
    currentStepLabel = failed?.label ?? null;
  } else {
    headline = params.status;
    progress = 0;
  }

  return { headline, progress, currentStepLabel, steps };
}
