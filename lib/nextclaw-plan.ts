import type { LearningPlanStepDraft, PlanToolName } from "@/lib/nextclaw-agent-types";

const PLAN_TOOLS = new Set<PlanToolName>([
  "search_notes", "read_note", "web_search", "fetch_url", "audit_content", "synthesize", "noop",
]);

export function normalizePlanSteps(value: unknown): LearningPlanStepDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): LearningPlanStepDraft[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) return [];
    const rawTool = typeof row.tool === "string" ? row.tool : null;
    const tool = rawTool && PLAN_TOOLS.has(rawTool as PlanToolName) ? rawTool as PlanToolName : null;
    const toolInput = row.toolInput && typeof row.toolInput === "object" && !Array.isArray(row.toolInput)
      ? { ...row.toolInput as Record<string, unknown> }
      : undefined;
    return [{
      id,
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "执行一步",
      tool,
      ...(toolInput ? { toolInput } : {}),
    }];
  });
}
