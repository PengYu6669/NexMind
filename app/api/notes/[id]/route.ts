import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { scheduleLearningJobsProcessing } from "@/lib/learning-jobs-kickoff";
import { indexNoteForRag } from "@/lib/rag";
import { syncOutgoingNoteLinksFromContent } from "@/lib/note-links-sync";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await context.params;

  const body = (await req.json()) as { title?: string; content?: string };
  const title = body.title?.trim();
  const content = body.content;

  if (typeof title !== "string" && typeof content !== "string") {
    return NextResponse.json({ error: "缺少 title 或 content" }, { status: 400 });
  }

  const updated = await prisma.note.updateMany({
    where: { id, userId: user.id },
    data: {
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof content === "string" ? { content } : {}),
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  if (typeof content === "string") {
    try {
      await syncOutgoingNoteLinksFromContent({
        userId: user.id,
        fromNoteId: id,
        html: content,
      });
    } catch {
      // 同步失败不阻断保存
    }
  }

  // 异步建立/更新向量索引（失败不影响保存主流程）
  try {
    const latest = await prisma.note.findFirst({
      where: { id, userId: user.id },
      select: { id: true, title: true, content: true },
    });
    if (latest) {
      await indexNoteForRag({
        userId: user.id,
        noteId: latest.id,
        title: latest.title,
        content: latest.content,
      });
    }
  } catch {
    // ignore
  }

  // 轻量自动学习：入队（防抖 30 秒），失败不影响保存主流程
  if (typeof content === "string") {
    try {
      const latest = await prisma.note.findFirst({
        where: { id, userId: user.id },
        select: { id: true, updatedAt: true, content: true },
      });
      const plainLen = (latest?.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
      const shouldEnqueue = Boolean(latest) && plainLen >= 300;
      if (latest && shouldEnqueue) {
        const runAt = new Date();
        // 合并防抖：清掉旧的待执行任务（避免频繁编辑堆积）
        await prisma.learningJob.deleteMany({
          where: {
            userId: user.id,
            noteId: latest.id,
            type: "NOTE_LEARN_LITE",
            status: "PENDING",
          },
        });
        await prisma.learningJob.create({
          data: {
            userId: user.id,
            noteId: latest.id,
            type: "NOTE_LEARN_LITE",
            status: "PENDING",
            runAt,
            noteUpdatedAt: latest.updatedAt,
            priority: 0,
          },
        });
        scheduleLearningJobsProcessing("note-save");
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await context.params;

  const deleted = await prisma.note.deleteMany({
    where: { id, userId: user.id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  // 删除后给前端一个可跳转的下一条笔记（若有）
  const next = await prisma.note.findFirst({
    where: { userId: user.id, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    nextNoteId: next?.id ?? null,
  });
}

