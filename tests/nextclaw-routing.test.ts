import { describe, expect, it } from "vitest";
import {
  routeAfterExecutor,
  routeAfterFetch,
  routeAfterFilter,
  routeAfterPlanner,
  routeAfterReason,
  routeAfterSupervisor,
  routeAfterWebSearch,
} from "@/lib/nextclaw-routing";

const state = (patch: Record<string, unknown> = {}) => patch as never;

describe("NextClaw conditional edges", () => {
  it("routes supervisor decisions", () => {
    expect(routeAfterSupervisor(state({ supervisorDecision: { route: "direct_plan", reason: "enough" } }))).toBe("plan");
    expect(routeAfterSupervisor(state({ supervisorDecision: { route: "retrieve_only", reason: "need context" } }))).toBe("reason");
  });

  it("routes search decision and results", () => {
    expect(routeAfterReason(state({ autoDecision: { needSearch: true, query: "LangGraph" } }))).toBe("need_search");
    expect(routeAfterReason(state({ autoDecision: { needSearch: false } }))).toBe("skip");
    expect(routeAfterWebSearch(state({ autoWebSearchResults: { query: "x", results: [] } }))).toBe("need_url");
    expect(routeAfterWebSearch(state({ autoWebSearchResults: { query: "x", results: [{ url: "https://example.com" }] } }))).toBe("go");
    expect(routeAfterWebSearch(state({ steps: [{ status: "failed" }] }))).toBe("skip");
  });

  it("routes source selection, fetch and planning", () => {
    expect(routeAfterFilter(state({ autoPick: { selectedUrl: "https://example.com" } }))).toBe("go");
    expect(routeAfterFilter(state())).toBe("skip");
    expect(routeAfterFetch(state({ autoFetched: { url: "https://example.com", markdown: "content" } }))).toBe("go");
    expect(routeAfterFetch(state())).toBe("skip");
    expect(routeAfterPlanner(state({ plan: { steps: [{ id: "1", title: "read", tool: "read_note" }] } }))).toBe("exec");
    expect(routeAfterPlanner(state({ plan: { steps: [] } }))).toBe("skip");
  });

  it("routes executor HITL", () => {
    expect(routeAfterExecutor(state({ hitl: { waitingFor: "source_url" } }))).toBe("need_url");
    expect(routeAfterExecutor(state())).toBe("go");
  });
});
