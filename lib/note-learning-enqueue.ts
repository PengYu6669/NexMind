import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "@/lib/auth";
import { scheduleLearningJobsProcessing } from "@/lib/learning-jobs-kickoff";
import { MIN_NOTE_PLAIN_CHARS_FOR_LEARNING } from "@/lib/learning-jobs-runner";
import { prisma } from "@/lib/prisma";

/**
 * 创建学习任务 DB 记录并触发队列处理（内部函数，不涉及 HTTP 响应）。
 * 笔记必须存在且正文长度足够，否则返回错误信息。
 */
export async function enqueueLearningJob(params: {
  userId: string;
  noteId: string;
  noteUpdatedAt: Date;
  mode: "lite" | "deep";
}): Promise<{ id: string } | { error: string; code: string }> {
  const note = await prisma.note.findFirst({
    where: { id: params.noteId, userId: params.userId },
    select: { id: true, content: true },
  });
  if (!note) {
    return { error: "笔记不存在", code: "NOTE_NOT_FOUND" };
  }
  const plainLen = (note.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  if (plainLen < MIN_NOTE_PLAIN_CHARS_FOR_LEARNING) {
    return { error: `内容过短（需至少 ${MIN_NOTE_PLAIN_CHARS_FOR_LEARNING} 字）`, code: "CONTENT_TOO_SHORT" };
  }
  const job = await prisma.learningJob.create({
    data: {
      userId: params.userId,
      noteId: params.noteId,
      type: params.mode === "deep" ? "NOTE_LEARN_DEEP" : "NOTE_LEARN_LITE",
      status: "PENDING",
      priority: params.mode === "deep" ? 10 : 1,
      runAt: new Date(),
      noteUpdatedAt: params.noteUpdatedAt,
    },
    select: { id: true },
  });
  scheduleLearningJobsProcessing("capture-auto-enqueue");
  return job;
}

/**
 * 手动触发笔记学习入队（轻量 / 深度）。
 * 笔记必须属于当前用户，且正文长度足够。
 */
export async function runLearningEnqueue(params: {
  user: AuthUser;
  noteId: string;
  mode: "lite" | "deep";
}) {
  const { user, noteId, mode } = params;

  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: user.id },
    select: { id: true, updatedAt: true, content: true },
  });

  if (!note) {
    return NextResponse.json(
      {
        error:
          "笔记不存在，或当前登录账号无权访问该笔记。请确认已登录、笔记已保存，且打开的不是他人/已删除的笔记。",
        code: "NOTE_OR_FORBIDDEN",
      },
      { status: 400 },
    );
  }

  const plainLen = (note.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  if (plainLen < MIN_NOTE_PLAIN_CHARS_FOR_LEARNING) {
    return NextResponse.json(
      {
        error: `内容过短（需至少约 ${MIN_NOTE_PLAIN_CHARS_FOR_LEARNING} 字纯文本），建议先写完再触发学习`,
        code: "CONTENT_TOO_SHORT",
      },
      { status: 400 }
    );
  }

  const runAt = new Date();
  const job = await prisma.learningJob.create({
    data: {
      userId: user.id,
      noteId: note.id,
      type: mode === "deep" ? "NOTE_LEARN_DEEP" : "NOTE_LEARN_LITE",
      status: "PENDING",
      priority: mode === "deep" ? 10 : 1,
      runAt,
      noteUpdatedAt: note.updatedAt,
    },
    select: { id: true, type: true, status: true, runAt: true },
  });

  scheduleLearningJobsProcessing("manual-enqueue");

  return NextResponse.json({ ok: true, job });
}

export function enqueueErrorResponse(e: unknown) {
  console.error("[learning enqueue]", e);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
    return NextResponse.json(
      {
        error:
          "数据库缺少学习相关表。请执行 npx prisma db push（或 migrate）并重启开发服务。",
        code: "DB_SCHEMA_MISSING",
      },
      { status: 503 },
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json(
    {
      error: "入队失败",
      code: "ENQUEUE_FAILED",
      ...(process.env.NODE_ENV === "development" ? { detail: message } : {}),
    },
    { status: 500 },
  );
}
