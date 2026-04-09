import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueErrorResponse, runLearningEnqueue } from "@/lib/note-learning-enqueue";
import { buildTaskUiPayload } from "@/lib/nextclaw-task-ui";
import { findLearningJobsForTaskDesk } from "@/lib/nextclaw-tasks-query";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const jobs = await findLearningJobsForTaskDesk(user.id, 30);

    const tasks = await Promise.all(
      jobs.map(async (j) => {
        const latestCard = j.noteId
          ? await prisma.learningCard.findFirst({
              where: { userId: user.id, noteId: j.noteId },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          : null;

        return {
          id: j.id,
          noteId: j.noteId,
          noteTitle: j.note?.title ?? "（无标题）",
          type: j.type,
          status: j.status,
          attempts: j.attempts,
          lastError: j.lastError,
          runAt: j.runAt.toISOString(),
          createdAt: j.createdAt.toISOString(),
          updatedAt: j.updatedAt.toISOString(),
          finishedAt: j.finishedAt?.toISOString() ?? null,
          plan: j.plan ?? null,
          steps: j.steps ?? null,
          ui: buildTaskUiPayload({ status: j.status, steps: j.steps }),
          result: j.noteId
            ? {
                noteUrl: `/notes/${j.noteId}`,
                latestCardId: latestCard?.id ?? null,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ ok: true, tasks });
  } catch (e) {
    console.error("[GET /api/nextclaw/tasks]", e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "加载学习任务失败",
        code: "TASKS_LIST_FAILED",
        ...(process.env.NODE_ENV === "development" ? { detail: message } : {}),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    noteId?: string;
    mode?: "lite" | "deep";
  };
  const noteId = body.noteId?.trim();
  if (!noteId) return NextResponse.json({ error: "缺少 noteId" }, { status: 400 });

  const mode = body.mode === "deep" ? "deep" : "lite";
  try {
    return await runLearningEnqueue({ user, noteId, mode });
  } catch (e) {
    return enqueueErrorResponse(e);
  }
}

