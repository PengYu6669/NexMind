type State = {
  supervisorDecision?: { route: "direct_plan" | "retrieve_and_search" | "retrieve_only" };
  autoDecision?: { needSearch: boolean; query?: string };
  autoWebSearchResults?: { results: unknown[] };
  autoPick?: { selectedUrl?: string };
  autoFetched?: { markdown?: string };
  plan?: { steps?: unknown[] };
  hitl?: { waitingFor?: string };
  steps?: Array<{ status?: string }>;
};

export function routeAfterSupervisor(state: State): "plan" | "reason" {
  return state.supervisorDecision?.route === "direct_plan" ? "plan" : "reason";
}

export function routeAfterReason(state: State): "need_search" | "skip" {
  return state.autoDecision?.needSearch && state.autoDecision.query ? "need_search" : "skip";
}

export function routeAfterWebSearch(state: State): "go" | "need_url" | "skip" {
  if (state.steps?.at(-1)?.status === "failed") return "skip";
  if (Array.isArray(state.autoWebSearchResults?.results) && state.autoWebSearchResults.results.length === 0) return "need_url";
  return state.autoWebSearchResults?.results?.length ? "go" : "skip";
}

export function routeAfterFilter(state: State): "go" | "skip" {
  return state.autoPick?.selectedUrl ? "go" : "skip";
}

export function routeAfterFetch(state: State): "go" | "skip" {
  return state.autoFetched?.markdown ? "go" : "skip";
}

export function routeAfterPlanner(state: State): "exec" | "skip" {
  return state.plan?.steps?.length ? "exec" : "skip";
}

export function routeAfterExecutor(state: State): "need_url" | "go" {
  return state.hitl?.waitingFor === "source_url" ? "need_url" : "go";
}
