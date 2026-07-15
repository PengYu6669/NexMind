import { describe, expect, it } from "vitest";
import { normalizePlanSteps } from "@/lib/nextclaw-plan";

describe("NextClaw plan normalization", () => {
  it("preserves validated tool input", () => {
    expect(normalizePlanSteps([{ id: " search ", title: "搜索", tool: "web_search", toolInput: { query: "LangGraph", topK: 3 } }]))
      .toEqual([{ id: "search", title: "搜索", tool: "web_search", toolInput: { query: "LangGraph", topK: 3 } }]);
  });

  it("drops invalid rows and unknown tools", () => {
    expect(normalizePlanSteps([null, { id: "", tool: "fetch_url" }, { id: "x", tool: "shell" }]))
      .toEqual([{ id: "x", title: "执行一步", tool: null }]);
  });
});
