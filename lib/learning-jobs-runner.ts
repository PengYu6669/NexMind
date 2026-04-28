import { AUTONOMOUS_MAX_ROUNDS, RAG_TOPK_DEEP, RAG_TOPK_LITE } from "@/lib/nextclaw-agent-config";
import type { PlanToolName } from "@/lib/nextclaw-agent-types";
import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";
import { executeTool } from "@/lib/nextclaw-agent-tools";
import { buildKbDigestFromRelated } from "@/lib/nextclaw-kb-digest";
import {
  createExecutionMetrics,
  markToolFailureEffect,
  shouldRetryTool,
  toEvaluationSummary,
} from "@/lib/nextclaw-workflow-policy";
import { prisma } from "@/lib/prisma";
import {
  auditorAgent,
  coachAgent,
  plannerAgent,
  retrieverAgent,
  roleLabel,
  schedulerAgent,
  type AgentRole,
} from "@/lib/nextclaw-multi-agent";
import { policyOf } from "@/lib/nextclaw-orchestrator-policy";
import { ragSearch, stripHtmlToText } from "@/lib/rag";
import { runNextClawLangGraphJob } from "@/lib/nextclaw-langgraph";
import { emitLearningJobEvent } from "@/lib/learning-job-events";

/** 与保存笔记自动入队、worker 跳过逻辑一致（纯文本字数，去 HTML） */
export const MIN_NOTE_PLAIN_CHARS_FOR_LEARNING = 300;

async function claimNextJobs(limit: number) {
  const now = new Date();
  const jobs = await prisma.learningJob.findMany({
    where: { status: "PENDING", runAt: { lte: now } },
    orderBy: [{ priority: "desc" }, { runAt: "asc" }],
    take: Math.max(1, Math.min(50, limit)),
  });

  const claimed: typeof jobs = [];
  for (const j of jobs) {
    const updated = await prisma.learningJob.updateMany({
      where: { id: j.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (updated.count > 0) claimed.push(j);
  }
  return claimed;
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
    const stepRecords: LearningJobStepRecord[] = [];
    const metrics = createExecutionMetrics();
    let fetchedMarkdown: { url: string; markdown: string } | null = null;
    let auditResult:
      | { conflicts: string[]; fillGaps: string[]; suggestedNoteIds: string[] }
      | null = null;
    let webSearchResults:
      | { query: string; results: { title?: string; url?: string; description?: string }[] }
      | null = null;
    const resumeMeta =
      job.plan &&
      typeof job.plan === "object" &&
      !Array.isArray(job.plan) &&
      "__resume" in (job.plan as Record<string, unknown>)
        ? ((job.plan as Record<string, unknown>).__resume as
            | { completedStepIds?: unknown; failedStepId?: unknown; fromJobId?: unknown }
            | undefined)
        : undefined;
    const resumedCompletedStepIds = new Set(
      Array.isArray(resumeMeta?.completedStepIds)
        ? resumeMeta!.completedStepIds.map((x) => String(x))
        : [],
    );
    const isResuming = resumedCompletedStepIds.size > 0 || Boolean(resumeMeta?.failedStepId);
    const toolTraceLines: string[] = [];
    const roleStats: Record<AgentRole, number> = {
      planner: 0,
      retriever: 0,
      auditor: 0,
      coach: 0,
      scheduler: 0,
    };

    async function flushSteps(extra?: { plan?: object }) {
      await prisma.learningJob.update({
        where: { id: job.id },
        data: {
          steps: stepRecords as any,
          ...(extra?.plan ? { plan: extra.plan as any } : {}),
        },
      });
      emitLearningJobEvent({ type: "job_updated", userId: job.userId, jobId: job.id });
      emitLearningJobEvent({ type: "jobs_changed", userId: job.userId });
    }

    async function ensureNotInterrupted() {
      const latest = await prisma.learningJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (!latest) throw new Error("任务不存在");
      if (latest.status === "CANCELLED") {
        throw new Error("任务已被用户中断");
      }
    }

    async function callToolWithPolicy(
      role: AgentRole,
      toolName: PlanToolName,
      args: Parameters<typeof executeTool>[1],
      retryStepLabel?: string,
    ) {
      const policy = policyOf(role);
      let attempt = 0;
      let result: Awaited<ReturnType<typeof executeTool>>;
      while (true) {
        attempt += 1;
        metrics.toolCalls += 1;
        roleStats[role] += 1;
        result = await executeTool(toolName, args);
        if (result.ok) return result;
        const allowRetryByPolicy = attempt <= policy.maxRetries;
        if (!allowRetryByPolicy || !shouldRetryTool(toolName, attempt, result)) {
          markToolFailureEffect(toolName, result, metrics);
          return result;
        }
        metrics.retries += 1;
        if (retryStepLabel) {
          stepRecords.push({
            id: `${toolName}-retry-${attempt}`,
            phase: "think",
            label: `${roleLabel(role)}：${retryStepLabel}`,
            status: "done",
            at: new Date().toISOString(),
            toolSummary: `第 ${attempt + 1} 次重试：${result.summary}`,
          });
          await flushSteps();
        }
      }
    }

    try {
      if (job.type !== "NOTE_LEARN_LITE" && job.type !== "NOTE_LEARN_DEEP") {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "暂不支持的 job type" },
        });
        skipped += 1;
        continue;
      }

      if (!job.noteId) {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "缺少 noteId" },
        });
        skipped += 1;
        continue;
      }
      const noteId = job.noteId;

      // LangGraph PoC：先迁移核心主链路（retrieve → plan → coach → persist）
      // 若出现运行时异常，仍由外层 catch 统一写 FAILED + evaluation-failed
      await runNextClawLangGraphJob({
        jobId: job.id,
        userId: job.userId,
        noteId,
        jobType: job.type,
      });
      succeeded += 1;
      continue;
    } catch (e) {
      const latest = await prisma.learningJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (latest?.status === "CANCELLED") {
        skipped += 1;
        continue;
      }
      const evaluation = toEvaluationSummary(metrics);
      stepRecords.push({
        id: "evaluation-failed",
        phase: "done",
        label: "任务评估与闭环记录（失败）",
        status: "failed",
        at: new Date().toISOString(),
        toolSummary: `toolCalls=${evaluation.toolCalls}; retries=${evaluation.retries}; degraded=${evaluation.degraded ? "yes" : "no"}; needHuman=${evaluation.needHumanIntervention ? "yes" : "no"}; durationMs=${evaluation.durationMs}`,
      });
      // 允许任务在执行中被替换/删除（例如旧版 resume 会删除旧 job）
      // 找不到记录时不应继续抛错，避免整个 kickoff 进程被打崩。
      await prisma.learningJob.updateMany({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          lastError: e instanceof Error ? e.message : String(e),
          ...(stepRecords.length
            ? { steps: stepRecords as any }
            : {}),
        },
      });
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
