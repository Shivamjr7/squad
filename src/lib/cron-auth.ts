import { timingSafeEqual } from "node:crypto";

// Constant-time Bearer-token check for CRON_SECRET-gated endpoints.
// Used by /api/cron/* and /api/suggest/health. Returns false (never
// throws) on any mismatch — the caller wraps this in a 401 response.
//
// `timingSafeEqual` throws if the buffers differ in length, so we
// length-equality-guard first. The early return on differing length
// is itself non-constant-time, but the secret length is fixed and not
// secret, so the only observable leak is "request had wrong-length
// token" vs "right-length wrong-value", which is fine.
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
