import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("blocks over-limit requests and resets after the window", () => {
    const key = `test:${Math.random()}`;
    expect(consumeRateLimit(key, { limit: 2, windowMs: 1000, now: 1000 }).allowed).toBe(true);
    expect(consumeRateLimit(key, { limit: 2, windowMs: 1000, now: 1001 }).allowed).toBe(true);
    expect(consumeRateLimit(key, { limit: 2, windowMs: 1000, now: 1002 }).allowed).toBe(false);
    expect(consumeRateLimit(key, { limit: 2, windowMs: 1000, now: 2001 }).allowed).toBe(true);
  });
});
