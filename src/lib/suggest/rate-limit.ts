// In-process token bucket for the Suggest server actions. Per
// 05-api-contracts.md / implementation-plan.md S5: 20 calls per user per
// minute. Intentionally simple — single Vercel instance memory; if abuse
// becomes real we move this to Postgres or Upstash. Per-instance buckets
// mean a multi-instance deploy effectively allows N×20/min, which is the
// accepted v1 trade-off.

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

type Bucket = {
  /** Epoch ms when the current window started. */
  windowStart: number;
  /** Calls observed in the current window. */
  count: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

/**
 * Records one call against `key` and returns whether it's allowed. Always
 * uses the most recent `now` so tests can inject deterministic clocks.
 */
export function takeToken(
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    const fresh: Bucket = { windowStart: now, count: 1 };
    buckets.set(key, fresh);
    return {
      ok: true,
      remaining: MAX_REQUESTS - 1,
      resetAt: fresh.windowStart + WINDOW_MS,
    };
  }

  if (existing.count >= MAX_REQUESTS) {
    const resetAt = existing.windowStart + WINDOW_MS;
    return { ok: false, retryAfterMs: resetAt - now, resetAt };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: MAX_REQUESTS - existing.count,
    resetAt: existing.windowStart + WINDOW_MS,
  };
}

/** Test seam — clears all buckets. */
export function _resetRateLimitForTests(): void {
  buckets.clear();
}

export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const RATE_LIMIT_MAX = MAX_REQUESTS;
