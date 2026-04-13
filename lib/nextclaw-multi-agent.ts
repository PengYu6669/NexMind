import type { LearningJobType } from "@prisma/client";
import { decideNeedWebSearch, pickBestFromWebResults } from "@/lib/nextclaw-autonomous-loop";
import { generateLearningPlan } from "@/lib/nextclaw-learning-plan";
import { generateNextClawAutoLearnLite } from "@/lib/nextclaw-auto-learn";

export type AgentRole = "planner" | "retriever" | "auditor" | "coach" | "scheduler";

export type PlannerInput = {
  noteTitle: string;
  noteSnippet: string;
  relatedLines: string[];
  jobType: LearningJobType;
  urls?: string[];
};

export type CoachInput = {
  noteTitle: string;
  noteHtml: string;
  relatedNotes: { noteId: string; title: string; snippet: string; distance?: number }[];
  kbDigest?: string;
  toolTrace?: string;
  mode?: "lite" | "deep";
};

export type RetrieverDecisionInput = {
  noteTitle: string;
  noteText: string;
  kbDigest: string;
};

export type RetrieverPickInput = {
  query: string;
  results: { title?: string; url?: string; description?: string }[];
};

/**
 * 轻量多智能体编排：先固化角色边界与输入输出契约。
 * 当前仍运行于同一 Runner，后续可替换为 LangGraph 或多进程执行器。
 */
export const plannerAgent = {
  role: "planner" as const,
  run(input: PlannerInput) {
    return generateLearningPlan(input);
  },
};

export const coachAgent = {
  role: "coach" as const,
  run(input: CoachInput) {
    return generateNextClawAutoLearnLite(input);
  },
};

export const retrieverAgent = {
  role: "retriever" as const,
  decideNeedWebSearch(input: RetrieverDecisionInput) {
    return decideNeedWebSearch(input);
  },
  pickBestSource(input: RetrieverPickInput) {
    return pickBestFromWebResults(input);
  },
};

export const auditorAgent = {
  role: "auditor" as const,
  summarizeAuditCounts(input: { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] }) {
    return {
      conflicts: Array.isArray(input.conflicts) ? input.conflicts.length : 0,
      fillGaps: Array.isArray(input.fillGaps) ? input.fillGaps.length : 0,
      suggested: Array.isArray(input.suggestedNoteIds) ? input.suggestedNoteIds.length : 0,
    };
  },
};

export const schedulerAgent = {
  role: "scheduler" as const,
  nextDueDate(baseNow = new Date(), intervalDays = 1) {
    return new Date(baseNow.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  },
};

export function roleLabel(role: AgentRole): string {
  if (role === "planner") return "Planner";
  if (role === "retriever") return "Retriever";
  if (role === "auditor") return "Auditor";
  if (role === "coach") return "Coach";
  return "Scheduler";
}
