import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractHeadingSection(md: string, heading: string): string | null {
  const startRe = new RegExp(`^#{2,}\\s*${escapeRegExp(heading)}\\s*$`, "im");
  const startM = startRe.exec(md);
  if (!startM || startM.index == null) return null;
  const startIndex = startM.index + startM[0].length;
  const rest = md.slice(startIndex);
  const nextHeadingRe = /^#{2,}\s*\S+/im;
  const nextM = nextHeadingRe.exec(rest);
  const endIndex = nextM ? startIndex + nextM.index : md.length;
  return md.slice(startIndex, endIndex).trim();
}

function extractBulletItems(text: string, max = 6): string[] {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => /^[-*]\s+/.test(x) || /^\d+\.\s+/.test(x))
    .map((x) => x.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function dayStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function diffDays(a: Date, b: Date): number {
  const ms = dayStart(a).getTime() - dayStart(b).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function dueLabelZh(dueDate: Date, today: Date): string {
  const delta = diffDays(today, dueDate);
  return delta <= 0 ? "今日" : `过期 ${delta} 天`;
}

function extractStepProgress(raw: unknown): { progress: number; currentStepLabel: string | null } {
  if (!Array.isArray(raw) || raw.length === 0) return { progress: 0.1, currentStepLabel: "初始化…" };
  const steps = raw
    .map((x) =>
      x && typeof x === "object"
        ? (x as { label?: unknown; status?: unknown })
        : { label: "", status: "" },
    )
    .filter((x) => typeof x.label === "string");
  const total = Math.max(1, steps.length);
  const done = steps.filter((x) => x.status === "done").length;
  const running = steps.find((x) => x.status === "running");
  const failed = steps.find((x) => x.status === "failed");
  if (failed) return { progress: Math.min(0.95, done / total), currentStepLabel: `失败：${String(failed.label)}` };
  if (running) return { progress: Math.min(0.96, (done + 0.35) / total), currentStepLabel: String(running.label) };
  return { progress: Math.min(0.92, done / total), currentStepLabel: `已完成 ${done}/${total} 步` };
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const now = new Date();
  const today0 = dayStart(now);
  const todayEnd = new Date(today0);
  todayEnd.setHours(23, 59, 59, 999);

  const [pendingReviewsRaw, todayCardsRaw, activeJobsRaw] = await Promise.all([
    prisma.reviewItem.findMany({
      where: { userId: user.id, dueDate: { lte: todayEnd } },
      orderBy: [{ easeFactor: "asc" }, { dueDate: "asc" }],
      take: 30,
      select: {
        id: true,
        noteId: true,
        dueDate: true,
        intervalDays: true,
        easeFactor: true,
        lastScore: true,
        lastReviewedAt: true,
        note: { select: { title: true } },
      },
    }),
    prisma.learningCard.findMany({
      where: { userId: user.id, createdAt: { gte: today0 }, type: { in: ["PITFALL", "FILL_GAP", "CONFLICT", "RELATED", "REVIEW", "AUDIT", "EXTERNAL"] } },
      orderBy: { createdAt: "desc" },
      take: 16,
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
    prisma.learningJob.findMany({
      where: { userId: user.id, status: "RUNNING" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        noteId: true,
        status: true,
        runAt: true,
        steps: true,
        note: { select: { title: true } },
      },
    }),
  ]);

  // pendingReviewsRaw 里逐条找最新 REVIEW 卡（N+1 但列表上限 30，可接受）
  const pendingReviews = await Promise.all(
    pendingReviewsRaw.map(async (r) => {
      const card = await prisma.learningCard.findFirst({
        where: { userId: user.id, noteId: r.noteId, type: "REVIEW" },
        orderBy: { createdAt: "desc" },
        select: { id: true, contentMd: true, title: true },
      });

      const contentMd = card?.contentMd ?? "";
      const selfTest = extractHeadingSection(contentMd, "自测问题");
      const answerPoints = extractHeadingSection(contentMd, "参考答案要点");
      const coreBefore = selfTest
        ? contentMd.slice(0, contentMd.indexOf(selfTest)).trim()
        : contentMd;

      return {
        reviewItemId: r.id,
        noteId: r.noteId,
        noteTitle: r.note.title ?? "（无标题）",
        lastScore: typeof r.lastScore === "number" ? r.lastScore : null,
        easeFactor: r.easeFactor,
        dueDate: r.dueDate.toISOString(),
        dueLabel: dueLabelZh(r.dueDate, today0),
        learningCardId: card?.id ?? null,
        // 用于右侧展示：尽量给“能复习”的信息而不是整段卡片
        reviewCardTitle: card?.title ?? "",
        reviewCardContentMd: contentMd,
        corePreview: mdToPlainSummary(coreBefore, 240),
        selfTestPreview: selfTest ? mdToPlainSummary(selfTest, 600) : mdToPlainSummary(contentMd, 600),
        answerPointsPreview: answerPoints ? mdToPlainSummary(answerPoints, 360) : "",
        answerPointItems: answerPoints ? extractBulletItems(answerPoints, 8) : [],
        estimatedMinutes: Math.max(
          1,
          Math.min(
            6,
            Math.round(
              ((selfTest ? selfTest.length : contentMd.length) + (answerPoints ? answerPoints.length : 0)) / 420,
            ),
          ),
        ),
      };
    }),
  );

  const todayCards = todayCardsRaw.map((c) => {
    const selfTest = extractHeadingSection(c.contentMd, "自测问题");
    const answerPoints = extractHeadingSection(c.contentMd, "参考答案要点");
    const pitfall = extractHeadingSection(c.contentMd, "易错点");
    const action = extractHeadingSection(c.contentMd, "怎么做");
    return {
      cardId: c.id,
      noteId: c.noteId,
      noteTitle: c.note.title ?? "（无标题）",
      dbType: c.type,
      title: c.title,
      summary: mdToPlainSummary(c.contentMd, 220),
      contentMdPreview: mdToPlainSummary(c.contentMd, 520),
      selfTestPreview: selfTest ? mdToPlainSummary(selfTest, 420) : "",
      answerPointItems: answerPoints ? extractBulletItems(answerPoints, 8) : [],
      actionItems: action ? extractBulletItems(action, 8) : [],
      pitfallItems: pitfall ? extractBulletItems(pitfall, 6) : [],
      contentMd: c.contentMd,
      createdAt: c.createdAt.toISOString(),
    };
  });

  const activeJobs = activeJobsRaw.map((j) => {
    const p = extractStepProgress(j.steps);
    return {
      jobId: j.id,
      type: j.type,
      noteTitle: j.note?.title ?? "（无标题）",
      progress: p.progress,
      currentStepLabel: p.currentStepLabel,
    };
  });

  return NextResponse.json({
    ok: true,
    pendingReviews: { items: pendingReviews, total: pendingReviews.length },
    todayCards,
    activeJobs,
    generatedAt: new Date().toISOString(),
  });
}

