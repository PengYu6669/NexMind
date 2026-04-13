import type { AgentRole } from "@/lib/nextclaw-multi-agent";

export type AgentPolicy = {
  role: AgentRole;
  enabled: boolean;
  maxRetries: number;
  degradeOnFailure: boolean;
};

/**
 * 轻量编排策略表：不依赖框架即可约束各角色行为。
 * 后续可映射到 LangGraph node/edge 的运行策略。
 */
export const NEXTCLAW_AGENT_POLICY: Record<AgentRole, AgentPolicy> = {
  planner: { role: "planner", enabled: true, maxRetries: 1, degradeOnFailure: false },
  retriever: { role: "retriever", enabled: true, maxRetries: 2, degradeOnFailure: true },
  auditor: { role: "auditor", enabled: true, maxRetries: 1, degradeOnFailure: true },
  coach: { role: "coach", enabled: true, maxRetries: 1, degradeOnFailure: false },
  scheduler: { role: "scheduler", enabled: true, maxRetries: 0, degradeOnFailure: false },
};

export function policyOf(role: AgentRole): AgentPolicy {
  return NEXTCLAW_AGENT_POLICY[role];
}
