import { lt } from "drizzle-orm";
import { db } from "@/db/client";
import { suggestionLogs } from "@/db/schema";

// S9 — suggestion_logs vacuum. Per 11-observability.md §Privacy &
// retention: rows older than 180 days are purged daily. ON DELETE CASCADE
// on `suggestion_log_items.log_id` removes the items in the same
// transaction, so this single DELETE keeps the surface clean.
//
// Aggregated metrics (acceptance rate, won rate, etc) live in the
// admin stats page over a 7-day window — well inside the retention bound
// — so this vacuum has no effect on dashboards.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RETENTION_DAYS = 180;

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

  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const deleted = await db
    .delete(suggestionLogs)
    .where(lt(suggestionLogs.generatedAt, cutoff))
    .returning({ id: suggestionLogs.id });

  console.log("evt=suggest.vacuum_suggestion_logs", {
    deleted: deleted.length,
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
  });

  return Response.json({
    ok: true,
    deleted: deleted.length,
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
  });
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}
