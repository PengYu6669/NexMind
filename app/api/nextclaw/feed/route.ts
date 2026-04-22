import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { learningCardToFeedDto } from "@/lib/nextclaw-feed";
import { buildTaskUiPayload } from "@/lib/nextclaw-task-ui";
import { scheduleLearningJobsProcessing } from "@/lib/learning-jobs-kickoff";

/** 智能流：跨笔记聚合学习卡片（对齐 PRD · Intelligence Feed） */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const take = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 25));

  let activeJobs: {
    id: string;
    status: string;
    type: string;
    noteTitle: string;
    ui: ReturnType<typeof buildTaskUiPayload>;
  }[] = [];

  try {
    const jobRows = await prisma.learningJob.findMany({
      where: {
        userId: user.id,
        OR: [
          { status: { in: ["PENDING", "RUNNING"] } },
          // HITL：等待用户输入来源 URL 的任务也要保持可见，否则中间工作流与右侧列表会“消失”
          { status: "CANCELLED", lastError: { contains: "HITL" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        status: true,
        type: true,
        steps: true,
        note: { select: { title: true } },
      },
    });
    const uiByJob = jobRows.map((j) => ({
      id: j.id,
      status: j.status,
      type: j.type,
      noteTitle: j.note?.title ?? "（无标题）",
      ui: buildTaskUiPayload({ status: j.status, steps: j.steps }),
    }));
    const noteIds = Array.from(
      new Set(
        uiByJob.flatMap((j) =>
          (j.ui.steps ?? [])
            .map((s) => (s.toolSummary ?? "").match(/noteId=([a-z0-9]+)/i)?.[1] ?? "")
            .filter(Boolean),
        ),
      ),
    );
    const titleMap = new Map<string, string>();
    if (noteIds.length) {
      const rows = await prisma.note.findMany({
        where: { userId: user.id, id: { in: noteIds } },
        select: { id: true, title: true },
      });
      for (const r of rows) titleMap.set(r.id, r.title || "（无标题）");
    }
    activeJobs = uiByJob.map((j) => {
      const generatedNotes = (j.ui.steps ?? [])
        .map((s) => {
          const id = (s.toolSummary ?? "").match(/noteId=([a-z0-9]+)/i)?.[1];
          if (!id) return null;
          return { id, title: titleMap.get(id) ?? "（新笔记）" };
        })
        .filter((x): x is { id: string; title: string } => Boolean(x));
      return {
        ...j,
        ui: {
          ...j.ui,
          generatedNotes,
        },
      };
    });
  } catch (e) {
    console.warn("[nextclaw/feed] activeJobs query failed (schema migration?)", e);
  }

  const [cardsRaw, pendingJobs] = await Promise.all([
    prisma.learningCard.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        noteId: true,
        type: true,
        title: true,
        contentMd: true,
        createdAt: true,
        note: { select: { title: true } },
      },
    }),
    prisma.learningJob.count({
      where: {
        userId: user.id,
        OR: [
          { status: { in: ["PENDING", "RUNNING"] } },
          { status: "CANCELLED", lastError: { contains: "HITL" } },
        ],
      },
    }),
  ]);

  // 自愈：若前端正在频繁轮询但队列未推进，则在响应后再 kick 一次处理（不阻塞 feed）。
  if (pendingJobs > 0) {
    scheduleLearningJobsProcessing("feed-poll", 6);
  }

  const noteIds = [...new Set(cardsRaw.map((c) => c.noteId))];
  const reviews = await prisma.reviewItem.findMany({
    where: { userId: user.id, noteId: { in: noteIds } },
    select: {
      id: true,
      noteId: true,
      dueDate: true,
      intervalDays: true,
      lastScore: true,
      lastReviewedAt: true,
    },
  });
  const reviewByNote = new Map(reviews.map((r) => [r.noteId, r]));

  const cards = cardsRaw.map((c) =>
    learningCardToFeedDto({
      id: c.id,
      noteId: c.noteId,
      noteTitle: c.note.title || "（无标题）",
      type: c.type,
      title: c.title,
      contentMd: c.contentMd,
      createdAt: c.createdAt,
      review: c.type === "REVIEW" ? (reviewByNote.get(c.noteId) ?? null) : null,
    })
  );

  return NextResponse.json({
    ok: true,
    cards,
    pendingJobs,
    activeJobs,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * 删除学习卡片
 * - 单删：{ cardId: string }
 * - 全删：{ all: true }
 */
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { cardId?: string; all?: boolean } | null;
  const cardId = typeof body?.cardId === "string" ? body.cardId.trim() : "";
  const all = body?.all === true;

  if (!all && !cardId) {
    return NextResponse.json({ error: "缺少 cardId 或 all=true" }, { status: 400 });
  }

  if (all) {
    const r = await prisma.learningCard.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ ok: true, deleted: r.count });
  }

  const r = await prisma.learningCard.deleteMany({ where: { id: cardId, userId: user.id } });
  if (r.count === 0) {
    return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deleted: r.count });
}
