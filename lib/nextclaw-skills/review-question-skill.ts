import { reviewQuestionInputSchema, type ReviewQuestionInput } from "@/lib/nextclaw-skills/types";

function firstSentence(text: string): string {
  const m = text.split(/[。！？!?\n]/).map((s) => s.trim()).find(Boolean);
  return m ?? text.slice(0, 80);
}

export type ReviewQuestionResult = {
  question: string;
  answerKeyPoints: string[];
  antiCopyCheck: {
    copiedPhraseRate: number;
    passed: boolean;
  };
};

export function runReviewQuestionSkill(raw: ReviewQuestionInput): ReviewQuestionResult {
  const input = reviewQuestionInputSchema.parse(raw);
  const kp = input.keyPoints.filter(Boolean).slice(0, 4);
  const base = kp[0] ?? firstSentence(input.noteText) ?? "核心概念";

  const question = `如果你在实际任务中要解释「${base.slice(0, 40)}」，请按“定义-步骤-风险”三段给出方案。`;
  const answerKeyPoints =
    kp.length > 0
      ? kp.map((x, i) => `${i + 1}. ${x.slice(0, 90)}`)
      : ["1. 先给出概念定义", "2. 给出落地步骤", "3. 说明常见误区与规避策略"];

  const normalized = input.noteText.replace(/\s+/g, "").toLowerCase();
  const copiedChars = question
    .replace(/\s+/g, "")
    .split("")
    .filter((ch) => normalized.includes(ch))
    .length;
  const copiedPhraseRate = question.length > 0 ? copiedChars / question.length : 1;

  return {
    question,
    answerKeyPoints,
    antiCopyCheck: {
      copiedPhraseRate: Number(copiedPhraseRate.toFixed(2)),
      passed: copiedPhraseRate < 0.85,
    },
  };
}
