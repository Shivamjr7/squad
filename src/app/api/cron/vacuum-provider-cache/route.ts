import { lt } from "drizzle-orm";
import { db } from "@/db/client";
import { providerCache } from "@/db/schema";

// S9 — provider_cache vacuum. The cache is a perf optimization with per-
// row TTL; we never read expired rows (provider-cache.ts checks
// expiresAt), but stale entries still consume disk + slow the `expiresAt`
// index over time. This job deletes anything past its TTL.
//
// Cadence: daily at 04:00 UTC via Vercel cron (vercel.json). Vercel Hobby
// caps cron frequency to once per day; the worst case is ~24h of expired
// rows sitting in the table, which is negligible at friend-group scale.
// The `expires_idx` makes the WHERE cheap regardless of stale rows.
//
// Spec: docs/specs/suggest-plan/09-data-model.md §provider_cache and
//       11-observability.md §Privacy & retention.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === secret;
}

async function run(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date();

  const deleted = await db
    .delete(providerCache)
    .where(lt(providerCache.expiresAt, cutoff))
    .returning({ key: providerCache.key });

  console.log("evt=suggest.vacuum_provider_cache", {
    deleted: deleted.length,
    cutoff: cutoff.toISOString(),
  });

  return Response.json({
    ok: true,
    deleted: deleted.length,
    cutoff: cutoff.toISOString(),
  });
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}
