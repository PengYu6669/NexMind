import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const RADAR_LABELS = ["冲突", "踩坑", "补位", "复习", "外部/审计", "关联"] as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function stageLabelFromIntervalDays(intervalDays: number): string {
  if (intervalDays >= 16) return "L4+";
  if (intervalDays >= 8) return "L4";
  if (intervalDays >= 4) return "L3";
  if (intervalDays >= 2) return "L2";
  return "L1";
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mdToPlainSummary(md: string, max = 420): string {
  const noFence = md.replace(/```[\s\S]*?```/g, " ");
  return noFence
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, max);
}

/** 分析看板：由学习卡片 / 复习任务推导的轻量指标（无向量也能用） */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [typeGroups, reviewItems, recentCardDates, pendingJobs, reviewQueue, learningCardsWeek] = await Promise.all([
    prisma.learningCard.groupBy({
      by: ["type"],
      where: { userId: user.id, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.reviewItem.findMany({
      where: { userId: user.id },
      select: { dueDate: true, intervalDays: true, lastScore: true, lastReviewedAt: true },
    }),
    prisma.learningCard.findMany({
      where: { userId: user.id, createdAt: { gte: tenDaysAgo } },
      select: { createdAt: true },
    }),
    prisma.learningJob.count({
      where: { userId: user.id, status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.reviewItem.findMany({
      where: { userId: user.id },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: {
        id: true,
        noteId: true,
        intervalDays: true,
        dueDate: true,
        note: { select: { title: true } },
      },
    }),
    prisma.learningCard.count({
      where: { userId: user.id, createdAt: { gte: sevenDaysAgo } },
    }),
  ]);

  const countMap: Record<string, number> = {};
  for (const g of typeGroups) {
    countMap[g.type] = g._count._all;
  }

  const maxC = Math.max(1, ...Object.values(countMap), 1);
  const radar = [
    { label: RADAR_LABELS[0], value: clamp01((countMap.CONFLICT ?? 0) / maxC) },
    { label: RADAR_LABELS[1], value: clamp01((countMap.PITFALL ?? 0) / maxC) },
    { label: RADAR_LABELS[2], value: clamp01((countMap.FILL_GAP ?? 0) / maxC) },
    { label: RADAR_LABELS[3], value: clamp01((countMap.REVIEW ?? 0) / maxC) },
    { label: RADAR_LABELS[4], value: clamp01(((countMap.EXTERNAL ?? 0) + (countMap.AUDIT ?? 0)) / maxC) },
    { label: RADAR_LABELS[5], value: clamp01((countMap.RELATED ?? 0) / maxC) },
  ];

  const scored = reviewItems.filter((r: any) => typeof r.lastScore === "number");
  const avgScore =
    scored.length > 0 ? scored.reduce((a: any, b: any) => a + (b.lastScore as number), 0) / scored.length : null;
  const retentionPercent = avgScore != null ? Math.round((avgScore / 5) * 100) : 0;

  const maxInterval = reviewItems.reduce((m: any, r: any) => Math.max(m, r.intervalDays), 0);
  let reviewStage = "L1";
  if (maxInterval >= 16) reviewStage = "L4+";
  else if (maxInterval >= 8) reviewStage = "L4";
  else if (maxInterval >= 4) reviewStage = "L3";
  else if (maxInterval >= 2) reviewStage = "L2";

  const queue = await Promise.all(
    reviewQueue.map(async (r: any) => {
      const card = await prisma.learningCard.findFirst({
        where: { userId: user.id, noteId: r.noteId, type: "REVIEW" },
        orderBy: { createdAt: "desc" },
        select: { id: true, contentMd: true, title: true },
      });

      const prompt = card?.contentMd ? mdToPlainSummary(card.contentMd, 520) : "";

      return {
        id: r.id,
        noteId: r.noteId,
        title: r.note?.title ?? "（已删除笔记）",
        stageLabel: stageLabelFromIntervalDays(r.intervalDays),
        dueDate: r.dueDate.toISOString(),
        learningCardId: card?.id ?? null,
        prompt: prompt || (card?.title ?? ""),
      };
    })
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueToday = reviewItems.filter((r: any) => {
    const d = new Date(r.dueDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }).length;

  // 按「本地日期」聚合近 10 天：学习卡片量 + 待复习/逾期量
  const cardsByDay = new Map<string, number>();
  for (const row of recentCardDates) {
    const k = localDayKey(row.createdAt);
    cardsByDay.set(k, (cardsByDay.get(k) ?? 0) + 1);
  }

  const reviewByDay = new Map<string, { due: number; overdue: number }>();
  for (const r of reviewItems) {
    const key = localDayKey(new Date(r.dueDate));
    const v = reviewByDay.get(key) ?? { due: 0, overdue: 0 };
    v.due += 1;
    reviewByDay.set(key, v);
  }

  const ribbon: { date: string; label: string; cards: number; due: number; overdue: number; heat: number; pulse?: boolean }[] = [];
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"] as const;
  for (let i = 9; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDayKey(d);
    const cards = cardsByDay.get(key) ?? 0;
    const due = reviewByDay.get(key)?.due ?? 0;
    const overdue = i === 0
      ? reviewItems.filter((r: any) => {
          const dd = new Date(r.dueDate);
          dd.setHours(0, 0, 0, 0);
          return dd.getTime() < today.getTime();
        }).length
      : 0;
    const heat = clamp01((cards + due) / 6);
    ribbon.push({
      date: key,
      label: i === 0 ? "今天" : `周${dayNames[d.getDay()]}`,
      cards,
      due,
      overdue,
      heat,
      pulse: i === 0 && (cards > 0 || due > 0 || overdue > 0),
    });
  }

  return NextResponse.json({
    ok: true,
    radar,
    stats: {
      retentionPercent,
      dueToday,
      reviewCount: reviewItems.length,
      pendingJobs,
      learningCardsWeek,
    },
    reviewStage,
    ribbon,
    reviewQueue: queue,
    generatedAt: new Date().toISOString(),
  });
}
