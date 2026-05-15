import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { suggestionLogs } from "@/db/schema";
import { sendSuggestStatsEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/url";

// S8 — weekly Suggest summary fan-out. Designed to be called by a Supabase
// pg_cron job (mirrors M15) that POSTs `Authorization: Bearer ${CRON_SECRET}`
// once per week. Body is empty; the route resolves all circles with at least
// one suggestion_log in the last 7d and emails their admins via Resend.
//
// Spec: docs/specs/suggest-plan/11-observability.md §Alerts.

export const dynamic = "force-dynamic";
// Pinned to the node runtime so Drizzle + postgres-js work; mirrors the
// only other API route that touches the DB at request time.
export const runtime = "nodejs";

const WINDOW_DAYS = 7;

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

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const activeCircles = await db
    .selectDistinct({ circleId: suggestionLogs.circleId })
    .from(suggestionLogs)
    .where(sql`${suggestionLogs.generatedAt} >= ${since}`);

  if (activeCircles.length === 0) {
    return Response.json({
      ok: true,
      circles: 0,
      sent: 0,
      windowDays: WINDOW_DAYS,
    });
  }

  const appUrl = await getAppUrl();
  let sentTotal = 0;
  const skipped: Array<{ circleId: string; reason: string }> = [];

  // Sequential to keep Resend pressure low; weekly job, no SLA.
  for (const row of activeCircles) {
    const result = await sendSuggestStatsEmail({
      circleId: row.circleId,
      appUrl,
      windowDays: WINDOW_DAYS,
    });
    sentTotal += result.sent;
    if (result.skipped) skipped.push({ circleId: row.circleId, reason: result.skipped });
  }

  console.log("evt=suggest.weekly_summary", {
    circles: activeCircles.length,
    sent: sentTotal,
    skipped: skipped.length,
    windowDays: WINDOW_DAYS,
  });

  return Response.json({
    ok: true,
    circles: activeCircles.length,
    sent: sentTotal,
    skipped,
    windowDays: WINDOW_DAYS,
  });
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

// GET supported so a manual `curl -H "Authorization: Bearer ..."` from a
// dev box can smoke-test the job without a body. Auth is identical.
export async function GET(req: Request): Promise<Response> {
  return run(req);
}
