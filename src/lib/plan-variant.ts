// M24 — pick which plan-detail skin to render. Pure function; no DB. The
// page passes a freshly-snapped `now` so the variant is deterministic per
// request (and shifts on the next refresh once thresholds cross).

export type PlanVariant = "decision" | "live-ticker" | "receipt";

// 30 minutes — when the deadline is closer than this AND the plan is still
// unlocked, switch to the dark live-ticker skin. Tuned per the M24 spec.
const TICKER_THRESHOLD_MS = 30 * 60 * 1000;

export function getPlanVariant(
  plan: {
    status: "active" | "confirmed" | "done" | "cancelled";
    decideBy: Date | null;
  },
  now: Date,
): PlanVariant {
  if (plan.status === "confirmed" || plan.status === "done") {
    return "receipt";
  }
  if (plan.status === "active" && plan.decideBy) {
    const remaining = plan.decideBy.getTime() - now.getTime();
    if (remaining > 0 && remaining < TICKER_THRESHOLD_MS) {
      return "live-ticker";
    }
  }
  return "decision";
}
