import { z } from "zod";

const optionalTrimmedString = (max: number) => z.string().trim().max(max).optional();

export const registerInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(128),
  name: optionalTrimmedString(80),
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  remember: z.union([z.boolean(), z.enum(["true", "false", "on", "1", "0"])]).optional(),
});

export const createNoteInputSchema = z.object({
  title: optionalTrimmedString(300),
  folderId: z.string().trim().min(1).max(128).nullable().optional(),
});

export const learningEnqueueInputSchema = z.object({
  mode: z.enum(["lite", "deep"]).default("lite"),
});

export const nextClawTaskActionInputSchema = z.object({
  action: z.enum(["pause", "override_source", "resume", "retry_from_step"]),
  url: z.string().trim().max(2048).optional(),
});

export const settingsInputSchema = z.object({
  profile: z.object({ name: z.string().trim().max(80).optional() }).optional(),
  userSettings: z.object({
    theme: z.enum(["dark", "light"]).optional(),
    nextclawMemoryEnabled: z.boolean().optional(),
  }).optional(),
}).strict();

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  noteId: z.string().trim().min(1).max(128).optional(),
  topK: z.number().int().min(1).max(15).default(3),
});

export const folderInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const memorySettingInputSchema = z.object({ memoryEnabled: z.boolean() });
export const captureInputSchema = z.object({
  input: z.string().trim().min(1).max(200_000),
  mode: z.enum(["lite", "deep"]).default("lite"),
});
export const internalBatchInputSchema = z.object({ limit: z.number().int().min(1).max(50).default(10) });
export const reviewScoreInputSchema = z.object({
  reviewItemId: z.string().trim().min(1).max(128),
  learningCardId: z.string().trim().min(1).max(128).optional(),
  score: z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).max(16)]).optional(),
  answer: z.string().trim().max(4000).optional(),
}).refine((value) => value.score !== undefined || Boolean(value.answer), {
  message: "请提供 score 或 answer",
});
export const updateNoteInputSchema = z.object({
  title: z.string().trim().max(300).optional(),
  content: z.string().max(2_000_000).optional(),
  folderId: z.string().trim().min(1).max(128).nullable().optional(),
  triggerLearning: z.boolean().optional(),
}).refine((value) => value.title !== undefined || value.content !== undefined || value.folderId !== undefined, {
  message: "缺少可更新字段（title / content / folderId）",
});
export const noteLinkInputSchema = z.object({
  fromNoteId: z.string().trim().min(1).max(128),
  toNoteId: z.string().trim().min(1).max(128),
});
export const createConversationInputSchema = z.object({ title: z.string().trim().max(200).default("新对话") });
export const conversationActionInputSchema = z.object({ action: z.literal("clearMessages") });
export const chatMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
  conversationId: z.string().trim().min(1).max(128).optional(),
  noteId: z.string().trim().min(1).max(128).optional(),
  learningCardId: z.string().trim().min(1).max(128).optional(),
  companion: z.boolean().optional(), nextclaw: z.boolean().optional(), autonomousStudy: z.boolean().optional(),
  attachmentSourceIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
});
export const saveNoteInputSchema = z.object({
  conversationId: z.string().trim().min(1).max(128).optional(),
  messageIds: z.array(z.string().trim().min(1).max(128)).max(100).optional(), raw: z.boolean().optional(),
});
export const noteAiInputSchema = z.object({
  action: z.enum(["summary", "expand", "polish", "outline", "qa", "actions"]),
  plainText: z.string().trim().min(1).max(12_000),
});
export const deleteCardsInputSchema = z.object({ cardId: z.string().trim().min(1).max(128).optional(), all: z.boolean().optional() })
  .refine((value) => value.all === true || Boolean(value.cardId), { message: "缺少 cardId 或 all=true" });
export const tasksEnqueueInputSchema = z.object({ noteId: z.string().trim().min(1).max(128), mode: z.enum(["lite", "deep"]).default("lite") });
export const studyAnalyzeInputSchema = z.object({
  userText: z.string().trim().min(1).max(4_000),
  assistantText: z.string().trim().min(1).max(8_000),
  focusNoteTitle: z.string().trim().max(300).nullable().optional(),
  relatedNotes: z.array(z.object({ noteId: z.string().trim().min(1).max(128), title: z.string().max(300), snippet: z.string().max(2_000) })).max(20).default([]),
});
export const studyAnalysisInputSchema = z.object({
  title: z.string().max(300), tags: z.array(z.string().max(80)).max(30), snapshotSummary: z.string().max(4_000),
  coreIdeas: z.array(z.string().max(1_000)).max(20), keywords: z.array(z.string().max(100)).max(30),
  enrichedPoints: z.array(z.string().max(2_000)).max(30),
  questions: z.array(z.object({ question: z.string().max(1_000), answerKeyPoints: z.array(z.string().max(500)).max(20) })).max(30),
  relatedNotes: z.array(z.object({ noteId: z.string().max(128), title: z.string().max(300), reason: z.string().max(1_000) })).max(30),
});

export function firstValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "请求参数无效";
}
