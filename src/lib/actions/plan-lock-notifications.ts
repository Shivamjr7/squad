import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { plans, votes } from "@/db/schema";
import {
  dispatchNotifications,
  resolvePlanAudience,
} from "@/lib/notifications";

// Server-internal lock notification helper. Used by exact auto-lock,
// manual confirm, and open-time heatmap lock so every lock path writes the
// same in-app + push payload.
export async function dispatchPlanLockedNotification(args: {
  planId: string;
  circleId: string;
  circleSlug: string;
  circleName: string;
  startsAt: Date;
  timeZone: string;
  location: string | null;
  trigger: "threshold" | "forced" | "all_voted";
}): Promise<void> {
  try {
    const [planRow, audience, inCountRow] = await Promise.all([
      db.query.plans.findFirst({
        columns: { title: true },
        where: eq(plans.id, args.planId),
      }),
      resolvePlanAudience(args.planId, args.circleId, null),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(votes)
        .where(and(eq(votes.planId, args.planId), eq(votes.status, "in"))),
    ]);
    if (!planRow || audience.length === 0) return;

    const inCount = Number(inCountRow[0]?.n ?? 0);
    await dispatchNotifications({
      type: "plan_locked",
      userIds: audience,
      payload: {
        planId: args.planId,
        planTitle: planRow.title,
        circleSlug: args.circleSlug,
        circleName: args.circleName,
        startsAtIso: args.startsAt.toISOString(),
        timeZone: args.timeZone,
        location: args.location,
        inCount,
        totalRecipients: audience.length,
        trigger: args.trigger,
      },
    });
  } catch (err) {
    console.error("[plan-lock-notifications] plan_locked dispatch failed", {
      planId: args.planId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
