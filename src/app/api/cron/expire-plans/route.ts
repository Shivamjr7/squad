import { NextResponse } from "next/server";
import { and, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { plans } from "@/db/schema";

// Hourly cron: any plan whose start time has passed and is still active or
// confirmed flips to `done`. No email — silent housekeeping. Plans cancelled
// or already done are left alone.

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
  const updated = await db
    .update(plans)
    .set({ status: "done" })
    .where(
      and(
        lt(plans.startsAt, now),
        inArray(plans.status, ["active", "confirmed"]),
      ),
    )
    .returning({ id: plans.id });

  const expired = updated.length;
  console.log("[cron] expire-plans", { expired, at: now.toISOString() });
  return NextResponse.json({ expired });
}
