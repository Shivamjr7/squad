import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanType } from "@/lib/validation/plan";
import { PlanMeta } from "./plan-meta";
import { PlanVotes } from "@/components/votes/plan-votes";

export type PlanCardData = {
  id: string;
  title: string;
  type: PlanType;
  startsAt: Date;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "done" | "cancelled";
  creator: {
    displayName: string;
    avatarUrl: string | null;
  } | null;
  commentCount: number;
};

export function PlanCard({
  plan,
  slug,
}: {
  plan: PlanCardData;
  slug: string;
}) {
  const isCancelled = plan.status === "cancelled";
  const showVotes = plan.status === "active";

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-card",
        isCancelled && "opacity-60",
      )}
    >
      <Link
        href={`/c/${slug}/p/${plan.id}`}
        prefetch
        className="group flex touch-manipulation flex-col gap-2 p-4 transition-colors duration-75 hover:bg-accent/50 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            className={cn(
              "flex-1 text-base font-medium leading-snug",
              isCancelled && "line-through",
            )}
          >
            {plan.title}
          </h3>
          {plan.status !== "active" ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {plan.status}
            </span>
          ) : null}
        </div>

        <PlanMeta
          type={plan.type}
          startsAt={plan.startsAt}
          isApproximate={plan.isApproximate}
          location={plan.location}
        />

        <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
          {plan.creator ? (
            <span className="inline-flex items-center gap-2">
              {plan.creator.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={plan.creator.avatarUrl}
                  alt=""
                  className="size-5 rounded-full object-cover"
                />
              ) : (
                <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase">
                  {plan.creator.displayName.slice(0, 1)}
                </span>
              )}
              <span className="truncate">{plan.creator.displayName}</span>
            </span>
          ) : (
            <span>Unknown</span>
          )}
          {plan.commentCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              aria-label={`${plan.commentCount} comment${plan.commentCount === 1 ? "" : "s"}`}
            >
              <MessageSquare className="size-3.5" aria-hidden />
              {plan.commentCount}
            </span>
          ) : null}
        </div>
      </Link>

      {showVotes ? (
        <div className="border-t px-4 py-3">
          <PlanVotes planId={plan.id} />
        </div>
      ) : null}
    </article>
  );
}
