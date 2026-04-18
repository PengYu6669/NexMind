import { cardQualityGuardInputSchema, type CardQualityGuardInput } from "@/lib/nextclaw-skills/types";

export type CardQualityGuardResult = {
  passed: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
};

export function runCardQualityGuardSkill(raw: CardQualityGuardInput): CardQualityGuardResult {
  const input = cardQualityGuardInputSchema.parse(raw);
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const lineCount = input.contentMd.split("\n").map((x) => x.trim()).filter(Boolean).length;
  const bulletCount = (input.contentMd.match(/^- /gm) ?? []).length + (input.contentMd.match(/^\d+\./gm) ?? []).length;
  const longParagraph = input.contentMd.split("\n").some((x) => x.trim().length >= 120);

  if ((input.title || "").trim().length < 4) {
    issues.push("标题过短");
    score -= 12;
  }
  if (lineCount < 4) {
    issues.push("内容过短");
    score -= 25;
    suggestions.push("补充定义、步骤和风险点");
  }
  if (bulletCount < 2) {
    issues.push("结构化不足");
    score -= 18;
    suggestions.push("增加列表或分点说明");
  }
  if (longParagraph) {
    issues.push("段落过长，阅读负担高");
    score -= 10;
    suggestions.push("拆成小标题+列表");
  }
  if (input.type === "REVIEW" && !/问题|自测|答案要点/.test(input.contentMd)) {
    issues.push("REVIEW 卡缺少自测题或答案要点");
    score -= 20;
  }

  const bounded = Math.max(0, Math.min(100, score));
  return {
    passed: bounded >= 70,
    score: bounded,
    issues,
    suggestions,
  };
}
