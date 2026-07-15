import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";
import { createExecutionMetrics, toEvaluationSummary } from "@/lib/nextclaw-workflow-policy";
import { emitLearningJobEvent } from "@/lib/learning-job-events";
import { runNextClawLangGraphJob } from "@/lib/nextclaw-langgraph";
import { prisma } from "@/lib/prisma";
import { classifyCompletedJobStatus, isRetryableJobError, retryDelayMs } from "@/lib/learning-job-status";
import type { LearningJob } from "@prisma/client";

export const MIN_NOTE_PLAIN_CHARS_FOR_LEARNING = 300;

const MAX_JOB_ATTEMPTS = Math.max(1, Number.parseInt(process.env.NEXTCLAW_JOB_MAX_ATTEMPTS ?? "3", 10) || 3);
const JOB_LEASE_MINUTES = Math.max(5, Number.parseInt(process.env.NEXTCLAW_JOB_LEASE_MINUTES ?? "30", 10) || 30);

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - JOB_LEASE_MINUTES * 60_000);
  await prisma.learningJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore }, attempts: { lt: MAX_JOB_ATTEMPTS } },
    data: { status: "PENDING", runAt: new Date(), startedAt: null, lastError: "任务执行超时，已自动重新排队" },
  });
  await prisma.learningJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore }, attempts: { gte: MAX_JOB_ATTEMPTS } },
    data: { status: "FAILED", finishedAt: new Date(), lastError: "任务执行超时且已达到最大重试次数" },
  });
}

async function claimNextJobs(limit: number): Promise<LearningJob[]> {
  const take = Math.max(1, Math.min(50, limit));
  await recoverStaleJobs();
  return prisma.$queryRaw<LearningJob[]>`
    WITH candidates AS (
      SELECT id
      FROM "LearningJob"
      WHERE status = 'PENDING' AND "runAt" <= NOW() AND attempts < ${MAX_JOB_ATTEMPTS}
      ORDER BY priority DESC, "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${take}
    )
    UPDATE "LearningJob" AS job
    SET status = 'RUNNING', "startedAt" = NOW(), "finishedAt" = NULL,
        attempts = job.attempts + 1, "updatedAt" = NOW()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  `;
}

async function markJobSkipped(jobId: string, lastError: string) {
  await prisma.learningJob.update({
    where: { id: jobId },
    data: { status: "SKIPPED", finishedAt: new Date(), lastError },
  });
}

async function requeueRetryableFailure(jobId: string): Promise<boolean> {
  const job = await prisma.learningJob.findUnique({
    where: { id: jobId },
    select: { status: true, attempts: true, lastError: true },
  });
  if (job?.status !== "FAILED" || job.attempts >= MAX_JOB_ATTEMPTS || !isRetryableJobError(job.lastError)) return false;
  await prisma.learningJob.updateMany({
    where: { id: jobId, status: "FAILED", attempts: job.attempts },
    data: {
      status: "PENDING",
      runAt: new Date(Date.now() + retryDelayMs(job.attempts)),
      startedAt: null,
      finishedAt: null,
      lastError: `第 ${job.attempts} 次执行失败，已安排重试：${job.lastError}`,
    },
  });
  return true;
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
      const completed = await prisma.learningJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      const outcome = classifyCompletedJobStatus(completed?.status);
      if (outcome === "succeeded") {
        succeeded += 1;
      } else if (outcome === "skipped") {
        skipped += 1;
      } else {
        await requeueRetryableFailure(job.id);
        failed += 1;
      }
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
      await requeueRetryableFailure(job.id);
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
