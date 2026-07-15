export type LearningJobOutcome = "succeeded" | "failed" | "skipped";

export function classifyCompletedJobStatus(status: string | null | undefined): LearningJobOutcome {
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "CANCELLED" || status === "WAITING_INPUT" || status === "SKIPPED") return "skipped";
  return "failed";
}

export function isRetryableJobError(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return ["timeout", "timed out", "429", "rate limit", "temporarily", "fetch failed", "网络", "connection", "p1001", "p1002"]
    .some((signal) => text.includes(signal));
}

export function retryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}
