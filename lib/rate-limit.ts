type Bucket = { count: number; resetAt: number };

declare global {
  var __nexmindRateLimitBuckets: Map<string, Bucket> | undefined;
}

const buckets = globalThis.__nexmindRateLimitBuckets ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") globalThis.__nexmindRateLimitBuckets = buckets;

export function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = options.now ?? Date.now();
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}
