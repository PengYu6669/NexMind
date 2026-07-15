import { describe, expect, it } from "vitest";
import {
  captureInputSchema,
  createNoteInputSchema,
  learningEnqueueInputSchema,
  registerInputSchema,
  reviewScoreInputSchema,
  searchInputSchema,
  settingsInputSchema,
} from "@/lib/api-inputs";
import { classifyCompletedJobStatus, isRetryableJobError, retryDelayMs } from "@/lib/learning-job-status";
import {
  createExecutionMetrics,
  markToolFailureEffect,
  shouldRetryTool,
} from "@/lib/nextclaw-workflow-policy";

describe("core API contracts", () => {
  it("normalizes valid registration input", () => {
    const parsed = registerInputSchema.parse({ email: " USER@Example.COM ", password: "123456" });
    expect(parsed.email).toBe("user@example.com");
  });

  it("rejects invalid note and enqueue inputs", () => {
    expect(createNoteInputSchema.safeParse({ title: "x".repeat(301) }).success).toBe(false);
    expect(learningEnqueueInputSchema.safeParse({ mode: "turbo" }).success).toBe(false);
  });

  it("rejects unsafe system settings and oversized/invalid requests", () => {
    expect(settingsInputSchema.safeParse({ envSettings: { SERPAPI_API_KEY: "secret" } }).success).toBe(false);
    expect(searchInputSchema.safeParse({ query: "x", topK: 100 }).success).toBe(false);
    expect(captureInputSchema.safeParse({ input: "", mode: "lite" }).success).toBe(false);
    expect(reviewScoreInputSchema.safeParse({ reviewItemId: "r1", score: "not-a-number" }).success).toBe(false);
    expect(reviewScoreInputSchema.safeParse({ reviewItemId: "r1" }).success).toBe(false);
  });
});

describe("learning job terminal state", () => {
  it.each([
    ["SUCCEEDED", "succeeded"],
    ["FAILED", "failed"],
    ["CANCELLED", "skipped"],
    ["WAITING_INPUT", "skipped"],
    ["SKIPPED", "skipped"],
  ])("classifies %s", (status, expected) => {
    expect(classifyCompletedJobStatus(status)).toBe(expected);
  });

  it("retries only transient failures with bounded exponential backoff", () => {
    expect(isRetryableJobError("fetch failed: timeout")).toBe(true);
    expect(isRetryableJobError("429 rate limit")).toBe(true);
    expect(isRetryableJobError("笔记不存在")).toBe(false);
    expect(retryDelayMs(2)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(15 * 60_000);
  });
});

describe("agent tool failure policy", () => {
  it("retries transient web failures once", () => {
    expect(shouldRetryTool("web_search", 1, { ok: false, summary: "429 rate limit" })).toBe(true);
    expect(shouldRetryTool("web_search", 2, { ok: false, summary: "429 rate limit" })).toBe(false);
  });

  it("marks optional web failure as degraded", () => {
    const metrics = createExecutionMetrics();
    markToolFailureEffect("fetch_url", { ok: false, summary: "timeout" }, metrics);
    expect(metrics.degraded).toBe(true);
    expect(metrics.needHumanIntervention).toBe(false);
  });

  it("requires human intervention for missing audit capability", () => {
    const metrics = createExecutionMetrics();
    markToolFailureEffect("audit_content", { ok: false, summary: "MCP 未启用" }, metrics);
    expect(metrics.degraded).toBe(true);
    expect(metrics.needHumanIntervention).toBe(true);
  });
});
