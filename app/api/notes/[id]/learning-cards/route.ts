import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let noteId: string;
  try {
    const p = await context.params;
    noteId = p.id;
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  try {
    const note = await prisma.note.findFirst({
      where: { id: noteId, userId: user.id },
      select: { id: true, updatedAt: true },
    });
    if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

    const cards = await prisma.learningCard.findMany({
      where: { userId: user.id, noteId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, title: true, contentMd: true, sources: true, createdAt: true, noteUpdatedAt: true },
    });

    const jobs = await prisma.learningJob.findMany({
      where: { userId: user.id, noteId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        priority: true,
        runAt: true,
        startedAt: true,
        finishedAt: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      note: { id: note.id, updatedAt: note.updatedAt },
      cards,
      jobs,
    });
  } catch (e) {
    console.error("[learning-cards GET]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return NextResponse.json(
        {
          error:
            "数据库缺少学习相关表。请在项目根目录执行：npx prisma migrate dev（或 migrate deploy），确保已应用迁移 20260402103000_add_learning_job_card_review。",
        },
        { status: 503 },
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    const hint =
      /LearningCard|LearningJob|ReviewItem|does not exist/i.test(message)
        ? "若刚升级代码，请执行 npx prisma migrate dev 同步数据库。"
        : undefined;
    return NextResponse.json(
      {
        error: "加载学习卡片失败",
        ...(process.env.NODE_ENV === "development" ? { detail: message, hint } : hint ? { hint } : {}),
      },
      { status: 500 },
    );
  }
}

