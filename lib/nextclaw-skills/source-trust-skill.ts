import { sourceTrustInputSchema, type SourceTrustInput } from "@/lib/nextclaw-skills/types";

const TRUSTED_HOST_SIGNS = [
  ".gov",
  ".edu",
  "developer.",
  "docs.",
  "github.com",
  "openai.com",
  "anthropic.com",
  "cloudflare.com",
  "microsoft.com",
  "google.com",
];

const LOW_TRUST_SIGNS = ["utm_", "clickbait", "广告", "博彩", "镜像站", "短链"];

export type SourceTrustResult = {
  score: number;
  level: "low" | "medium" | "high";
  reasons: string[];
};

export function runSourceTrustSkill(raw: SourceTrustInput): SourceTrustResult {
  const input = sourceTrustInputSchema.parse(raw);
  const reasons: string[] = [];
  let score = 50;

  let host = "";
  try {
    host = new URL(input.url).hostname.toLowerCase();
    score += 8;
  } catch {
    reasons.push("URL 格式异常");
    score -= 20;
  }

  if (host && TRUSTED_HOST_SIGNS.some((s) => host.includes(s))) {
    reasons.push("来源域名偏权威");
    score += 18;
  }

  const corpus = `${input.title}\n${input.snippet}\n${input.markdown}`.toLowerCase();
  if (LOW_TRUST_SIGNS.some((s) => corpus.includes(s))) {
    reasons.push("存在低可信信号");
    score -= 18;
  }

  if ((input.markdown || "").length > 1200) {
    reasons.push("正文信息量较充足");
    score += 10;
  } else {
    reasons.push("正文较短，证据有限");
    score -= 6;
  }

  const bounded = Math.max(0, Math.min(100, score));
  const level = bounded >= 75 ? "high" : bounded >= 50 ? "medium" : "low";
  return { score: bounded, level, reasons };
}
