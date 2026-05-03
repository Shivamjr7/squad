import { NextResponse } from "next/server";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { plans } from "@/db/schema";
import { sendPlanReminderEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/url";

// Hourly cron: confirmed plans starting 1-2h from now get a single reminder
// to everyone who voted IN. Active (still-being-voted-on) plans are skipped
// — we don't nag about plans that aren't locked in.

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const lower = new Date(now.getTime() + 60 * 60 * 1000);
  const upper = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Atomic claim: anything matching gets reminder_sent_at stamped in one
  // UPDATE. Returned IDs are the rows we successfully claimed; any concurrent
  // cron firing will see those rows as already-sent and skip them.
  const claimed = await db
    .update(plans)
    .set({ reminderSentAt: sql`now()` })
    .where(
      and(
        eq(plans.status, "confirmed"),
        gte(plans.startsAt, lower),
        lt(plans.startsAt, upper),
        isNull(plans.reminderSentAt),
      ),
    )
    .returning({ id: plans.id });

  if (claimed.length === 0) {
    console.log("[cron] remind-plans", { reminded: 0, at: now.toISOString() });
    return NextResponse.json({ reminded: 0 });
  }

  const appUrl = await getAppUrl();
  // Fire per-plan in parallel; each call swallows its own errors so a single
  // failed plan doesn't block the rest.
  await Promise.all(
    claimed.map((row) => sendPlanReminderEmail(row.id, appUrl)),
  );

  console.log("[cron] remind-plans", {
    reminded: claimed.length,
    at: now.toISOString(),
  });
  return NextResponse.json({ reminded: claimed.length });
}
