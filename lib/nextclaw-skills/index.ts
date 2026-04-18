import {
  type CardQualityGuardInput,
  type ConflictAuditInput,
  type NextClawSkillName,
  type ReviewQuestionInput,
  type SourceTrustInput,
} from "@/lib/nextclaw-skills/types";
import { runSourceTrustSkill, type SourceTrustResult } from "@/lib/nextclaw-skills/source-trust-skill";
import { runConflictAuditSkill, type ConflictAuditResult } from "@/lib/nextclaw-skills/conflict-audit-skill";
import { runReviewQuestionSkill, type ReviewQuestionResult } from "@/lib/nextclaw-skills/review-question-skill";
import { runCardQualityGuardSkill, type CardQualityGuardResult } from "@/lib/nextclaw-skills/card-quality-guard-skill";

export type NextClawSkillInputMap = {
  source_trust: SourceTrustInput;
  conflict_audit: ConflictAuditInput;
  review_question: ReviewQuestionInput;
  card_quality_guard: CardQualityGuardInput;
};

export type NextClawSkillOutputMap = {
  source_trust: SourceTrustResult;
  conflict_audit: ConflictAuditResult;
  review_question: ReviewQuestionResult;
  card_quality_guard: CardQualityGuardResult;
};

export function runNextClawSkill<T extends NextClawSkillName>(
  name: T,
  input: NextClawSkillInputMap[T],
): NextClawSkillOutputMap[T] {
  if (name === "source_trust") return runSourceTrustSkill(input as SourceTrustInput) as NextClawSkillOutputMap[T];
  if (name === "conflict_audit") return runConflictAuditSkill(input as ConflictAuditInput) as NextClawSkillOutputMap[T];
  if (name === "review_question") return runReviewQuestionSkill(input as ReviewQuestionInput) as NextClawSkillOutputMap[T];
  return runCardQualityGuardSkill(input as CardQualityGuardInput) as NextClawSkillOutputMap[T];
}

export * from "@/lib/nextclaw-skills/types";
