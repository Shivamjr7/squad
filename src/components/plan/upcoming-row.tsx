import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PlanType } from "@/lib/validation/plan";
import { formatPlanTime } from "@/lib/format-plan-time";
import { VoteSummaryInline } from "./vote-summary-inline";

const TYPE_BAR: Record<PlanType, string> = {
  eat: "bg-[#4CAF50]",
  play: "bg-[#2196F3]",
  chai: "bg-[#FF9800]",
  "stay-in": "bg-[#9E9E9E]",
  other: "bg-[#9E9E9E]",
};

export type UpcomingRowData = {
  id: string;
  title: string;
  type: PlanType;
  startsAt: Date;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "confirmed" | "done" | "cancelled";
};

export function UpcomingRow({
  plan,
  slug,
  now,
}: {
  plan: UpcomingRowData;
  slug: string;
  now: Date;
}) {
  // formatPlanTime returns "today, 8:00 PM" etc. Swap the comma for a dot to
  // match the editorial separator used in the redesign.
  const whenLabel = formatPlanTime(plan.startsAt, plan.isApproximate, now)
    .replace(", ", " · ");

  return (
    <Link
      href={`/c/${slug}/p/${plan.id}`}
      prefetch
      className="group flex touch-manipulation items-stretch gap-3 rounded-lg bg-paper-card transition-colors duration-100 hover:bg-paper-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
    >
      <span
        aria-hidden
        className={cn("w-[3px] shrink-0 rounded-full", TYPE_BAR[plan.type])}
      />
      <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate text-[15px] font-semibold text-ink">
              {plan.title}
            </h3>
            <span className="shrink-0 text-xs text-ink-muted">{whenLabel}</span>
          </div>
          {plan.location ? (
            <p className="truncate text-xs text-ink-muted">{plan.location}</p>
          ) : null}
        </div>
        <VoteSummaryInline planId={plan.id} />
      </div>
    </Link>
  );
}
