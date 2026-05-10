import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";
import { createExecutionMetrics, toEvaluationSummary } from "@/lib/nextclaw-workflow-policy";
import { emitLearningJobEvent } from "@/lib/learning-job-events";
import { runNextClawLangGraphJob } from "@/lib/nextclaw-langgraph";
import { prisma } from "@/lib/prisma";

export const MIN_NOTE_PLAIN_CHARS_FOR_LEARNING = 300;

async function claimNextJobs(limit: number) {
  const now = new Date();
  const jobs = await prisma.learningJob.findMany({
    where: { status: "PENDING", runAt: { lte: now } },
    orderBy: [{ priority: "desc" }, { runAt: "asc" }],
    take: Math.max(1, Math.min(50, limit)),
  });

  const claimed: typeof jobs = [];
  for (const job of jobs) {
    const updated = await prisma.learningJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (updated.count > 0) claimed.push(job);
  }
  return claimed;
}

async function markJobSkipped(jobId: string, lastError: string) {
  await prisma.learningJob.update({
    where: { id: jobId },
    data: { status: "SKIPPED", finishedAt: new Date(), lastError },
  });
}

function buildFailureStep(metrics: ReturnType<typeof createExecutionMetrics>): LearningJobStepRecord {
  const evaluation = toEvaluationSummary(metrics);
  return {
    id: "evaluation-failed",
    phase: "done",
    label: "任务评估与闭环记录（失败）",
    status: "failed",
    at: new Date().toISOString(),
    toolSummary: `toolCalls=${evaluation.toolCalls}; retries=${evaluation.retries}; degraded=${
      evaluation.degraded ? "yes" : "no"
    }; needHuman=${evaluation.needHumanIntervention ? "yes" : "no"}; durationMs=${evaluation.durationMs}`,
  };
}

export type LearningJobsBatchResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export async function executeLearningJobsBatch(limit: number): Promise<LearningJobsBatchResult> {
  const claimed = await claimNextJobs(limit);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of claimed) {
    const metrics = createExecutionMetrics();

    try {
      if (job.type !== "NOTE_LEARN_LITE" && job.type !== "NOTE_LEARN_DEEP") {
        await markJobSkipped(job.id, "暂不支持的 job type");
        skipped += 1;
        continue;
      }

      if (!job.noteId) {
        await markJobSkipped(job.id, "缺少 noteId");
        skipped += 1;
        continue;
      }

      await runNextClawLangGraphJob({
        jobId: job.id,
        userId: job.userId,
        noteId: job.noteId,
        jobType: job.type,
      });
      succeeded += 1;
    } catch (e) {
      const latest = await prisma.learningJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (latest?.status === "CANCELLED") {
        skipped += 1;
        continue;
      }

      const failureStep = buildFailureStep(metrics);
      await prisma.learningJob.updateMany({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          lastError: e instanceof Error ? e.message : String(e),
          steps: [failureStep] as unknown as object,
        },
      });
      emitLearningJobEvent({ type: "job_updated", userId: job.userId, jobId: job.id });
      emitLearningJobEvent({ type: "jobs_changed", userId: job.userId });
      failed += 1;
    }
  }

  return {
    claimed: claimed.length,
    succeeded,
    failed,
    skipped,
  };
}
