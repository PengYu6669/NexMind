import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function verifyCron(req: Request): boolean {
  const token = process.env.INTERNAL_CRON_TOKEN?.trim();
  if (!token) return false;
  const auth = req.headers.get("authorization")?.trim();
  return auth === `Bearer ${token}`;
}

/**
 * 内部定时任务：为每位用户写入一条「日快照」占位摘要（可接 cron：每日一次）。
 * 鉴权：Authorization: Bearer INTERNAL_CRON_TOKEN
 */
export async function POST(req: Request) {
  if (!verifyCron(req)) {
    return NextResponse.json(
      { error: process.env.INTERNAL_CRON_TOKEN ? "未授权" : "服务未配置 INTERNAL_CRON_TOKEN" },
      { status: process.env.INTERNAL_CRON_TOKEN ? 401 : 503 }
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({ select: { id: true } });
  let created = 0;

  for (const { id: userId } of users) {
    const [notesUpdated, msgCount] = await Promise.all([
      prisma.note.count({
        where: { userId, updatedAt: { gte: since }, archived: false },
      }),
      prisma.message.count({
        where: {
          conversation: { userId },
          createdAt: { gte: since },
        },
      }),
    ]);

    const recentNotes = await prisma.note.findMany({
      where: { userId, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { title: true },
    });
    const titles = recentNotes.map((n) => n.title || "（无标题）").filter(Boolean);

    const summary = `近 24 小时：更新笔记 ${notesUpdated} 篇，相关对话消息约 ${msgCount} 条。`;
    await prisma.learningSnapshot.create({
      data: {
        userId,
        summary,
        recommendations: {
          recentNoteTitles: titles,
          generatedAt: new Date().toISOString(),
        },
        periodStart: since,
        periodEnd: new Date(),
      },
    });
    created += 1;
  }

  return NextResponse.json({ ok: true, users: users.length, snapshotsCreated: created });
}
