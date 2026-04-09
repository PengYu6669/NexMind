import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * SM-2（简化版）：
 * - 用户评分：0-5 分（PRD 自评）
 * - 质量因子 q：直接使用 0-5
 * - 易用系数 easeFactor 按 SM-2 更新，并 clamp >= 1.3
 * - intervalDays：无“repetition”字段时用 lastReviewedAt + intervalDays 近似
 */
function sm2Update(params: {
  prevEaseFactor: number;
  prevIntervalDays: number;
  prevLastReviewedAt: Date | null;
  score0to5: number;
}): { nextEaseFactor: number; nextIntervalDays: number } {
  const { prevEaseFactor, prevIntervalDays, prevLastReviewedAt, score0to5 } = params;

  const q = clamp(score0to5, 0, 5);
  let nextEaseFactor =
    prevEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  nextEaseFactor = Math.max(1.3, nextEaseFactor);

  // 评分过低（<3）视为未掌握：重置间隔到 1 天
  if (q < 3) {
    return { nextEaseFactor, nextIntervalDays: 1 };
  }

  const isFirstReview = !prevLastReviewedAt;
  const prevIsSecondStep = prevIntervalDays <= 1;

  // 首次复习：从 1 天开始；第二次（或仍在 1 天间隔）：提升到 6 天
  if (isFirstReview || prevIsSecondStep) {
    return { nextEaseFactor, nextIntervalDays: 6 };
  }

  return { nextEaseFactor, nextIntervalDays: Math.max(1, Math.round(prevIntervalDays * nextEaseFactor)) };
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { reviewItemId?: unknown; learningCardId?: unknown; score?: unknown; answer?: unknown }
    | null;
  const reviewItemId = body?.reviewItemId;
  const learningCardId = body?.learningCardId;
  const scoreRaw = body?.score;
  const answerRaw = body?.answer;

  if (typeof reviewItemId !== "string" || reviewItemId.trim().length === 0) {
    return NextResponse.json({ error: "reviewItemId 无效" }, { status: 400 });
  }
  const hasManualScore = typeof scoreRaw === "number" || typeof scoreRaw === "string";
  const manualScore = hasManualScore ? clamp(Math.round(Number(scoreRaw)), 0, 5) : null;
  const answer =
    typeof answerRaw === "string" ? answerRaw.trim() : answerRaw != null ? String(answerRaw).trim() : "";

  if (!hasManualScore && !answer) {
    return NextResponse.json({ error: "缺少评分信息：请提供 score 或 answer" }, { status: 400 });
  }

  const now = new Date();

  const review = await prisma.reviewItem.findFirst({
    where: { id: reviewItemId, userId: user.id },
    select: {
      id: true,
      intervalDays: true,
      easeFactor: true,
      lastReviewedAt: true,
    },
  });

  if (!review) {
    return NextResponse.json({ error: "复习条目不存在" }, { status: 404 });
  }

  let score: number;
  let aiParsed:
    | { matchedKeyPoints: string[]; missingKeyPoints: string[]; feedback: string }
    | undefined;

  if (manualScore != null) {
    score = manualScore;
  } else {
    if (typeof learningCardId !== "string" || learningCardId.trim().length === 0) {
      return NextResponse.json({ error: "learningCardId 无效" }, { status: 400 });
    }

    const card = await prisma.learningCard.findFirst({
      where: { id: learningCardId, userId: user.id, type: "REVIEW" },
      select: { contentMd: true, title: true },
    });

    if (!card) return NextResponse.json({ error: "复习卡片不存在" }, { status: 404 });

    const model = process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";
    const system =
      "你是智能复习评分器。你将获得：1) 一段“自测题（Q + 答案要点）”文本（可能包含答案要点），2) 用户的回答。你需要：a) 按 0-5 分对用户掌握度评分（整数），b) 解析出匹配/缺失的答案要点（用于解释），c) 用一句简短反馈说明用户哪里做得好/还缺什么。必须严格输出 JSON（不要 Markdown，不要解释）：{score:number(0-5), matchedKeyPoints:string[], missingKeyPoints:string[], feedback:string}";

    try {
      const raw = await callDashscopeChatCompletion({
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              selfTestText: card.contentMd.slice(0, 6000),
              cardTitle: card.title,
              userAnswer: answer.slice(0, 4000),
            }),
          },
        ],
      });

      const parsed = extractJsonFromText(raw) as {
        score?: unknown;
        matchedKeyPoints?: unknown;
        missingKeyPoints?: unknown;
        feedback?: unknown;
      };

      const scoreParsed =
        typeof parsed?.score === "number" ? parsed.score : Number(parsed?.score);
      if (!Number.isFinite(scoreParsed)) {
        throw new Error("AI 返回 score 不是数字");
      }

      score = clamp(Math.round(scoreParsed), 0, 5);
      // “解析”结果用于返回给前端展示；SM2 只依赖 score
      const matchedKeyPoints = Array.isArray(parsed?.matchedKeyPoints)
        ? parsed.matchedKeyPoints.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [];
      const missingKeyPoints = Array.isArray(parsed?.missingKeyPoints)
        ? parsed.missingKeyPoints.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [];
      const feedback =
        typeof parsed?.feedback === "string" ? parsed.feedback.trim().slice(0, 300) : "评分完成";

      aiParsed = { matchedKeyPoints, missingKeyPoints, feedback };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI 评分失败";
      return NextResponse.json({ error: `AI 评分/解析失败：${msg}` }, { status: 500 });
    }
  }

  const { nextEaseFactor, nextIntervalDays } = sm2Update({
    prevEaseFactor: review.easeFactor,
    prevIntervalDays: review.intervalDays,
    prevLastReviewedAt: review.lastReviewedAt,
    score0to5: score,
  });

  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + nextIntervalDays);

  await prisma.reviewItem.update({
    where: { id: review.id },
    data: {
      lastScore: score,
      lastReviewedAt: now,
      intervalDays: nextIntervalDays,
      easeFactor: nextEaseFactor,
      dueDate,
    },
  });

  return NextResponse.json({
    ok: true,
    reviewItemId: review.id,
    lastScore: score,
    intervalDays: nextIntervalDays,
    easeFactor: nextEaseFactor,
    dueDate: dueDate.toISOString(),
    aiParsed,
    generatedAt: now.toISOString(),
  });
}

