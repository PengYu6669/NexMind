import type { LearningJobType } from "@prisma/client";
import { decideNeedWebSearch, pickBestFromWebResults } from "@/lib/nextclaw-autonomous-loop";
import { generateLearningPlan } from "@/lib/nextclaw-learning-plan";
import { generateNextClawAutoLearnLite } from "@/lib/nextclaw-auto-learn";
import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";

export type AgentRole =
  | "supervisor"
  | "planner"
  | "retriever"
  | "source_analyst"
  | "auditor"
  | "coach"
  | "scheduler";

export type SupervisorInput = {
  noteSourceType?: string;
  noteText?: string;
  hasRelatedNotes: boolean;
  requestedMode: LearningJobType;
  hitlOverrideUrl?: string;
};

export type SupervisorDecision = {
  route: "direct_plan" | "retrieve_and_search" | "retrieve_only";
  reason: string;
};

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

export const supervisorAgent = {
  role: "supervisor" as const,
  run(input: SupervisorInput): SupervisorDecision {
    if (input.hitlOverrideUrl?.trim()) {
      return {
        route: "retrieve_and_search",
        reason: "检测到人工指定来源，优先走补源链路后再规划。",
      };
    }
    if (input.noteSourceType === "capture") {
      return {
        route: "direct_plan",
        reason: "capture 来源正文较完整，跳过额外联网补源。",
      };
    }
    if (!input.hasRelatedNotes && (input.noteText?.trim().length ?? 0) < 800) {
      return {
        route: "retrieve_and_search",
        reason: "现有上下文偏少，先补齐外部来源再规划。",
      };
    }
    return {
      route: "retrieve_only",
      reason: "先基于知识库检索与本地上下文判断是否需要继续联网。",
    };
  },

  /** LLM 路由：感知内容语义，替代纯规则判断（+1 次轻量 LLM 调用） */
  async runWithLLM(input: SupervisorInput): Promise<SupervisorDecision> {
    // HITL overrideUrl 和 capture 来源仍然是确定性路由
    if (input.hitlOverrideUrl?.trim()) {
      return {
        route: "retrieve_and_search",
        reason: "检测到人工指定来源，优先走补源链路后再规划。",
      };
    }
    if (input.noteSourceType === "capture") {
      return {
        route: "direct_plan",
        reason: "capture 来源正文较完整，跳过额外联网补源。",
      };
    }

    const model =
      process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";
    const noteSnippet = (input.noteText ?? "").slice(0, 600);

    try {
      const raw = await callDashscopeChatCompletion({
        model,
        messages: [
          {
            role: "system",
            content: `你是学习任务路由器。根据笔记摘要判断下一步行动。

规则：
- direct_plan：笔记正文足够丰富（>800字且有结构化内容），可直接规划学习
- retrieve_and_search：笔记简短、缺少权威来源或涉及需要验证的事实，应先联网搜索
- retrieve_only：笔记中等长度，先检索知识库相关内容，再决定是否需要联网

只输出 JSON：{"route":"direct_plan|retrieve_and_search|retrieve_only","reason":"一句话理由"}`,
          },
          {
            role: "user",
            content: `笔记摘要：${noteSnippet}\n关联笔记数：${input.hasRelatedNotes ? "有" : "无"}\n任务类型：${input.requestedMode}`,
          },
        ],
      });

      const parsed = extractJsonFromText(raw);
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const route = obj.route as string;
        const reason = (obj.reason as string) || "LLM 路由判断";
        if (
          route === "direct_plan" ||
          route === "retrieve_and_search" ||
          route === "retrieve_only"
        ) {
          return { route, reason };
        }
      }
      throw new Error("LLM 输出无法解析");
    } catch {
      // LLM 失败 → 退回规则路由
      return supervisorAgent.run(input);
    }
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

export const sourceAnalystAgent = {
  role: "source_analyst" as const,
  summarizeCandidates(input: {
    query: string;
    candidates: { url: string; title?: string; score?: number; fetchedChars?: number; selected?: boolean }[];
  }) {
    const picked = input.candidates.find((x) => x.selected);
    const top = input.candidates
      .slice(0, 3)
      .map((x) => `${x.title || x.url}#${x.score ?? "na"}`)
      .join("；");
    return {
      summary: picked
        ? `候选 ${input.candidates.length} 个，优先采用「${picked.title || picked.url}」`
        : `候选 ${input.candidates.length} 个，暂无可用来源`,
      detail: top || `query=${input.query}`,
    };
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
  if (role === "supervisor") return "Supervisor";
  if (role === "planner") return "Planner";
  if (role === "retriever") return "Retriever";
  if (role === "source_analyst") return "Source Analyst";
  if (role === "auditor") return "Auditor";
  if (role === "coach") return "Coach";
  return "Scheduler";
}
