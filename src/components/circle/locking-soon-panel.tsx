import Link from "next/link";
import { and, asc, eq, gt, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { Clock } from "lucide-react";
import { db } from "@/db/client";
import { circles, memberships, plans } from "@/db/schema";
import { circleDotClass } from "@/lib/circle-color";
import { formatDecideBy } from "@/lib/format-decide-by";
import { cn } from "@/lib/utils";

// Right-rail card surfacing cross-circle plans that lock in the next two
// hours. Independent from the Plans-tab feed query: this is a small
// "don't miss this" widget, not a full feed.
//
// Server component — queries inside Suspense in the parent so the hero
// paints before this finishes. Hidden when no plans match (the parent
// renders this unconditionally; we return null for the empty case).

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const LIMIT = 4;

type Row = {
  id: string;
  title: string;
  decideBy: Date;
  circleId: string;
  circleSlug: string;
  circleName: string;
};

async function getLockingSoon(userId: string, now: Date): Promise<Row[]> {
  const horizon = new Date(now.getTime() + TWO_HOURS_MS);
  const rows = await db
    .select({
      id: plans.id,
      title: plans.title,
      decideBy: plans.decideBy,
      circleId: plans.circleId,
      circleSlug: circles.slug,
      circleName: circles.name,
    })
    .from(plans)
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, plans.circleId),
        eq(memberships.userId, userId),
      ),
    )
    .innerJoin(circles, eq(circles.id, plans.circleId))
    .where(
      and(
        eq(plans.status, "active"),
        isNotNull(plans.decideBy),
        gt(plans.decideBy, now),
        lt(plans.decideBy, horizon),
        ne(plans.status, "cancelled"),
        // Mirror the recipient-visibility rule used by the cross-circle
        // feed: implicit-full-circle OR explicit recipient OR creator.
        or(
          sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
          sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
          eq(plans.createdBy, userId),
        ),
      ),
    )
    .orderBy(asc(plans.decideBy))
    .limit(LIMIT);

  return rows
    .filter((r): r is typeof r & { decideBy: Date } => r.decideBy !== null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      decideBy: r.decideBy,
      circleId: r.circleId,
      circleSlug: r.circleSlug,
      circleName: r.circleName,
    }));
}

export async function LockingSoonPanel({ userId }: { userId: string }) {
  const now = new Date();
  const rows = await getLockingSoon(userId, now);
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="locking-soon-heading"
      className="rounded-3xl border border-ink/10 bg-paper-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        <Clock className="size-3 text-coral-strong" aria-hidden />
        <h2
          id="locking-soon-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
        >
          Locking soon
        </h2>
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {rows.map((row) => {
          const countdown = formatDecideBy(row.decideBy, now);
          return (
            <li key={row.id}>
              <Link
                href={`/c/${row.circleSlug}/p/${row.id}`}
                prefetch
                className="-mx-2 flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-paper-elevated focus-visible:outline-none focus-visible:bg-paper-elevated focus-visible:ring-2 focus-visible:ring-coral"
              >
                <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      circleDotClass(row.circleId),
                    )}
                  />
                  <span className="truncate">{row.circleName}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-ink">
                    {row.title}
                  </span>
                  {countdown ? (
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-coral-strong tabular-nums">
                      {countdown}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LockingSoonSkeleton() {
  return (
    <section
      aria-hidden
      className="rounded-3xl border border-ink/10 bg-paper-card p-4 shadow-sm"
    >
      <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
      <ul className="mt-3 flex flex-col gap-2">
        {[0, 1].map((i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="h-2.5 w-20 animate-pulse rounded bg-ink/10" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-ink/10" />
          </li>
        ))}
      </ul>
    </section>
  );
}
