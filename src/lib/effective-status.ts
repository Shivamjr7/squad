// Derive a plan's effective status at READ time. The raw plans.status enum
// (active | confirmed | done | cancelled) doesn't know that a plan's
// startsAt has slipped into the past — a future pg_cron job should flip
// status='done' server-side, but until then we need to treat any plan
// whose startsAt has already passed as "past" wherever vote / calendar /
// edit UI is decided. NEVER write effectiveStatus back to the DB.
//
// TODO M6 pg_cron: UPDATE plans SET status='done'
//   WHERE starts_at < now() AND status IN ('active', 'confirmed') — run hourly.

export type RawStatus = "active" | "confirmed" | "done" | "cancelled";
export type EffectiveStatus =
  | "deciding"
  | "voting"
  | "locked"
  | "lapsed"
  | "past"
  | "cancelled";

export function getEffectiveStatus(
  plan: {
    status: RawStatus;
    startsAt: Date;
    decideBy?: Date | null;
    inCount?: number;
    lockThreshold?: number;
    timeMode?: "exact" | "open";
    venueOptionCount?: number;
  },
  now: Date = new Date(),
): EffectiveStatus {
  if (plan.status === "cancelled") return "cancelled";
  if (plan.status === "done") return "past";
  if (plan.startsAt.getTime() < now.getTime()) return "past";
  if (plan.status === "confirmed") return "locked";
  if (
    plan.decideBy &&
    plan.decideBy.getTime() <= now.getTime() &&
    (plan.inCount ?? 0) < (plan.lockThreshold ?? Number.POSITIVE_INFINITY)
  ) {
    return "lapsed";
  }
  // active — distinguish voting (multi-venue or open-time) from deciding
  if (
    (plan.venueOptionCount ?? 0) >= 2 ||
    plan.timeMode === "open"
  ) {
    return "voting";
  }
  return "deciding";
}

// The simplest read-time check: is this plan in the past? Use this when
// you only need the boolean to gate vote UI / calendar deep-links, not
// the full effective status tone.
export function isPastPlan(
  plan: { status: RawStatus; startsAt: Date },
  now: Date = new Date(),
): boolean {
  if (plan.status === "done") return true;
  return plan.startsAt.getTime() < now.getTime();
}
