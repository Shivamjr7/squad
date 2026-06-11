// Pick which plan-detail skin to render. Pure function; no DB. The page
// passes a freshly-snapped `now` so the variant is deterministic per
// request (and shifts on the next refresh once thresholds cross).
//
// Three skins:
//   - decision   → active plan with no decide-by deadline yet
//   - live-ticker → active plan with a decide-by deadline (any remaining)
//                   — renders the Live Dashboard cockpit (Plan Detail C):
//                   ring + countdown + squad grid + sticky RSVP
//   - receipt    → any settled state (confirmed / done / cancelled)
//
// Earlier rev gated `live-ticker` to the final 30 min of the deadline.
// The cockpit is the right surface whenever a deadline exists, not only
// in the last half-hour — the countdown is the cockpit's headline.

export type PlanVariant = "decision" | "live-ticker" | "receipt";

export function getPlanVariant(
  plan: {
    status: "active" | "confirmed" | "done" | "cancelled";
    decideBy: Date | null;
    inCount?: number;
    lockThreshold?: number;
  },
  now: Date,
): PlanVariant {
  if (
    plan.status === "confirmed" ||
    plan.status === "done" ||
    plan.status === "cancelled"
  ) {
    return "receipt";
  }
  if (
    plan.status === "active" &&
    plan.decideBy &&
    plan.decideBy.getTime() <= now.getTime() &&
    (plan.inCount ?? 0) < (plan.lockThreshold ?? Number.POSITIVE_INFINITY)
  ) {
    return "receipt";
  }
  if (
    plan.status === "active" &&
    plan.decideBy &&
    plan.decideBy.getTime() > now.getTime()
  ) {
    return "live-ticker";
  }
  return "decision";
}
