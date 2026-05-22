import { lt } from "drizzle-orm";
import { db } from "@/db/client";
import { providerCache, rateLimits, webhookEvents } from "@/db/schema";
import { isAuthorizedCron } from "@/lib/cron-auth";

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

async function run(req: Request): Promise<Response> {
  if (!isAuthorizedCron(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date();

  const deleted = await db
    .delete(providerCache)
    .where(lt(providerCache.expiresAt, cutoff))
    .returning({ key: providerCache.key });

  // Vacuum stale rate-limit rows in the same pass. Rows older than 1 day
  // are guaranteed dead — the longest active window is 1h, so anything
  // 24h+ stale is just heap bloat. Cheap, indexed by window_start.
  const rateCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deletedRates = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, rateCutoff))
    .returning({ key: rateLimits.key });

  // Vacuum webhook idempotency log. Svix's replay window is 5min, so 24h
  // is comfortable headroom. Indexed by received_at.
  const webhookCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deletedWebhooks = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, webhookCutoff))
    .returning({ svixId: webhookEvents.svixId });

  console.log("evt=suggest.vacuum_provider_cache", {
    deleted: deleted.length,
    deletedRateLimits: deletedRates.length,
    deletedWebhookEvents: deletedWebhooks.length,
    cutoff: cutoff.toISOString(),
  });

  return Response.json({
    ok: true,
    deleted: deleted.length,
    deletedRateLimits: deletedRates.length,
    deletedWebhookEvents: deletedWebhooks.length,
    cutoff: cutoff.toISOString(),
  });
}

// Vercel Cron sends POST. We do not export GET — accepting it would let a
// link prefetch or stray browser click trigger the vacuum.
export async function POST(req: Request): Promise<Response> {
  return run(req);
}
