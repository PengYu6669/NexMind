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

  const body = (await req.json()) as {
    title?: string;
    content?: string;
    folderId?: string | null;
    triggerLearning?: boolean;
  };
  const content = body.content;
  const triggerLearning = body.triggerLearning === true;
  const hasTitle = typeof body.title === "string";
  const hasContent = typeof body.content === "string";
  const hasFolder = "folderId" in body;

  if (!hasTitle && !hasContent && !hasFolder) {
    return NextResponse.json({ error: "缺少可更新字段（title / content / folderId）" }, { status: 400 });
  }

  let folderIdUpdate: string | null | undefined;
  if (hasFolder) {
    if (body.folderId === null) {
      folderIdUpdate = null;
    } else if (typeof body.folderId === "string") {
      const fo = await prisma.noteFolder.findFirst({
        where: { id: body.folderId, userId: user.id },
        select: { id: true },
      });
      if (!fo) {
        return NextResponse.json({ error: "文件夹不存在" }, { status: 400 });
      }
      folderIdUpdate = body.folderId;
    } else {
      return NextResponse.json({ error: "folderId 无效" }, { status: 400 });
    }
  }

  const updated = await prisma.note.updateMany({
    where: { id, userId: user.id },
    data: {
      ...(hasTitle ? { title: body.title!.trim() || "无标题" } : {}),
      ...(hasContent ? { content: body.content as string } : {}),
      ...(folderIdUpdate !== undefined ? { folderId: folderIdUpdate } : {}),
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

  // 仅标题/正文变更时重建向量；仅移动文件夹不触发索引
  if (hasTitle || hasContent) {
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
  }

  // 学习任务改为“显式触发”：
  // 自动保存会非常频繁，若每次都入队会造成大量 token 消耗。
  // 仅当前端明确传 triggerLearning=true 时才创建学习任务。
  if (typeof content === "string" && triggerLearning) {
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

