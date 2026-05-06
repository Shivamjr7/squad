"use server";

import { db } from "@/db/client";
import { planEvents } from "@/db/schema";

export type PlanEventKind =
  | "created"
  | "voted"
  | "proposed_time"
  | "proposed_venue"
  | "added_member"
  | "locked"
  | "cancelled";

// Append one row to plan_events. Best-effort: failures are swallowed and
// logged because the activity log is secondary — losing an event must not
// break the user-facing action that triggered it. Callers inside an open
// transaction should write the row inline (`tx.insert(planEvents)...`) so
// the event lives or dies with the parent mutation.
export async function recordPlanEvent(args: {
  planId: string;
  userId: string | null;
  kind: PlanEventKind;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(planEvents).values({
      planId: args.planId,
      userId: args.userId,
      kind: args.kind,
      payload: args.payload ?? null,
    });
  } catch (err) {
    console.error("[plan-events] insert failed", {
      planId: args.planId,
      kind: args.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
