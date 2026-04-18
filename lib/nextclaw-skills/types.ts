import { z } from "zod";

export type NextClawSkillName =
  | "source_trust"
  | "conflict_audit"
  | "review_question"
  | "card_quality_guard";

export const sourceTrustInputSchema = z.object({
  url: z.string().trim().min(1),
  title: z.string().optional().default(""),
  snippet: z.string().optional().default(""),
  markdown: z.string().optional().default(""),
});

export const conflictAuditInputSchema = z.object({
  noteText: z.string().optional().default(""),
  fetchedMarkdown: z.string().optional().default(""),
  relatedNotes: z
    .array(
      z.object({
        noteId: z.string(),
        title: z.string(),
        snippet: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

export const reviewQuestionInputSchema = z.object({
  cardTitle: z.string().optional().default(""),
  noteText: z.string().optional().default(""),
  keyPoints: z.array(z.string()).optional().default([]),
});

export const cardQualityGuardInputSchema = z.object({
  type: z.enum(["REVIEW", "FILL_GAP", "PITFALL", "CONFLICT", "RELATED", "AUDIT"]),
  title: z.string().optional().default(""),
  contentMd: z.string().optional().default(""),
});

export type SourceTrustInput = z.infer<typeof sourceTrustInputSchema>;
export type ConflictAuditInput = z.infer<typeof conflictAuditInputSchema>;
export type ReviewQuestionInput = z.infer<typeof reviewQuestionInputSchema>;
export type CardQualityGuardInput = z.infer<typeof cardQualityGuardInputSchema>;
