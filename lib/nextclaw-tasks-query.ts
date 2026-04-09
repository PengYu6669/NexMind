import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const JOB_LIST_SELECT_FULL = {
  id: true,
  noteId: true,
  type: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  runAt: true,
  finishedAt: true,
  plan: true,
  steps: true,
  note: { select: { title: true } },
} as const;

const JOB_LIST_SELECT_LEGACY = {
  id: true,
  noteId: true,
  type: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  runAt: true,
  finishedAt: true,
  note: { select: { title: true } },
} as const;

export type LearningJobListRow = {
  id: string;
  noteId: string | null;
  type: import("@prisma/client").LearningJobType;
  status: import("@prisma/client").LearningJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  runAt: Date;
  finishedAt: Date | null;
  plan: unknown | null;
  steps: unknown | null;
  note: { title: string } | null;
};

function isPlanStepsUnavailableError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2022") return true;
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    return /\b(plan|steps)\b/.test(e.message);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /column\s+.*\b(plan|steps)\b|\"plan\"|\"steps\"/i.test(msg);
}

/**
 * 读取学习任务列表；若 DB 尚未迁移出 plan/steps，则自动降级查询，避免 500。
 */
export async function findLearningJobsForTaskDesk(userId: string, take = 30): Promise<LearningJobListRow[]> {
  try {
    const rows = await prisma.learningJob.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take,
      select: JOB_LIST_SELECT_FULL,
    });
    return rows as LearningJobListRow[];
  } catch (e) {
    if (!isPlanStepsUnavailableError(e)) throw e;
    console.warn(
      "[nextclaw/tasks] plan/steps unavailable (migrate: npx prisma db push), using legacy select:",
      e instanceof Error ? e.message : e
    );
    const rows = await prisma.learningJob.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take,
      select: JOB_LIST_SELECT_LEGACY,
    });
    return rows.map((j) => ({
      ...j,
      plan: null,
      steps: null,
    }));
  }
}
