"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { UpcomingRow, type UpcomingRowData } from "./upcoming-row";
import type { PlanCardData } from "./plan-card";
import { PlansSwipeDeck } from "./plans-swipe-deck";
import { HeroQuestion } from "@/components/ui/hero-question";

export type MyPlansPagePlan = Omit<PlanCardData, "startsAt"> & {
  startsAt: string;
};

type Filter = "current" | "past";
type ViewMode = "list" | "swipe";

const VIEW_STORAGE_KEY = "squad.plans.view";

export function MyPlansPage({
  plans,
  slug,
}: {
  plans: MyPlansPagePlan[];
  slug: string;
}) {
  const [filter, setFilter] = useState<Filter>("current");
  // Hydration-safe: SSR + first client render share the default, then we
  // upgrade to whatever localStorage remembered.
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "swipe" || stored === "list") setView(stored);
    } catch {
      // Storage disabled (Safari private etc.) — silently keep default.
    }
  }, []);

  const setViewPersisted = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore — view still works, just won't survive reloads.
    }
  };

  const normalizedPlans = useMemo(
    () =>
      plans
        .map((plan) => ({ ...plan, startsAt: new Date(plan.startsAt) }))
        .filter((plan) => !Number.isNaN(plan.startsAt.getTime())),
    [plans],
  );

  // Stable per-mount `now` so date-bucketing labels don't reshuffle every
  // render. The Realtime updates that matter here (vote tallies) flow
  // through useCircleVotes inside each row, not through `now`.
  const now = useMemo(() => new Date(), []);

  const currentPlans = useMemo(
    () =>
      normalizedPlans
        .filter(
          (p) =>
            p.status !== "done" &&
            p.status !== "cancelled" &&
            p.startsAt >= now,
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    [normalizedPlans, now],
  );

  const pastPlans = useMemo(
    () =>
      normalizedPlans
        .filter(
          (p) =>
            p.status === "done" ||
            p.status === "cancelled" ||
            p.startsAt < now,
        )
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
    [normalizedPlans, now],
  );

  // Quick counts for the editorial subline: "3 deciding · 1 locked · 2 past".
  const stats = useMemo(() => {
    let deciding = 0;
    let locked = 0;
    for (const p of currentPlans) {
      if (p.status === "active") deciding += 1;
      else if (p.status === "confirmed") locked += 1;
    }
    return { deciding, locked, past: pastPlans.length };
  }, [currentPlans, pastPlans]);

  // Swipe view only makes sense for current/active plans (a past plan can't
  // be re-voted). When the user flips to Past, the swipe toggle disappears
  // and the effective view falls back to list.
  const effectiveView: ViewMode = filter === "past" ? "list" : view;
  const visible = filter === "current" ? currentPlans : pastPlans;
  const visibleBuckets = useMemo(() => bucketPlans(visible, now, filter), [
    visible,
    now,
    filter,
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-32 sm:px-6">
      {/* Editorial header — matches M16 home/plan-detail rhythm: eyebrow,
          serif title with italic accent, muted stat subline. */}
      <header className="flex flex-col gap-3">
        <span className="eyebrow text-ink-muted">My plans</span>
        <HeroQuestion
          prefix={<>What&rsquo;s on,</>}
          accent={headerAccent(filter)}
          size="md"
        />
        <p className="text-sm text-ink-muted">{statsLine(stats)}</p>
      </header>

      {/* Filter + view toggle row. Segmented control left, ghost view-mode
          chip right. On mobile they wrap; on desktop they sit side-by-side. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "current", label: "Current" },
            { value: "past", label: "Past" },
          ]}
        />

        {filter === "current" ? (
          <ViewToggle
            value={effectiveView}
            onChange={setViewPersisted}
          />
        ) : null}
      </div>

      {effectiveView === "swipe" ? (
        <PlansSwipeDeck plans={currentPlans} slug={slug} now={now} />
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="flex flex-col gap-6">
          {visibleBuckets.map((bucket) => (
            <section key={bucket.label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="eyebrow text-ink-muted">{bucket.label}</h2>
                <span className="text-[11px] text-ink-muted tabular-nums">
                  {bucket.items.length}
                </span>
              </div>
              <div className="flex flex-col divide-y divide-ink/5 overflow-hidden rounded-2xl border border-ink/5 bg-paper-card shadow-card">
                {bucket.items.map((plan) => (
                  <UpcomingRow
                    key={plan.id}
                    plan={toUpcomingRowData(plan)}
                    slug={slug}
                    now={now}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Subcomponents ----------

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-full border border-ink/10 bg-paper p-1 shadow-sm"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-ink text-paper shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Plan view"
      className="inline-flex rounded-full border border-ink/10 bg-paper p-1 shadow-sm"
    >
      <ViewButton
        active={value === "list"}
        onClick={() => onChange("list")}
        label="List"
        icon={<List className="size-4" aria-hidden />}
      />
      <ViewButton
        active={value === "swipe"}
        onClick={() => onChange("swipe")}
        label="Swipe"
        icon={<LayoutGrid className="size-4" aria-hidden />}
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-ink text-paper"
          : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <section className="mt-2 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-14 text-center">
      <span className="eyebrow text-ink-muted">
        {filter === "current" ? "All quiet" : "Nothing past"}
      </span>
      <h3 className="font-serif text-2xl font-semibold text-ink">
        {filter === "current" ? (
          <>
            No plans on the{" "}
            <em className="font-serif italic font-normal text-coral">
              calendar
            </em>{" "}
            yet.
          </>
        ) : (
          <>
            No{" "}
            <em className="font-serif italic font-normal text-coral">
              past
            </em>{" "}
            plans yet.
          </>
        )}
      </h3>
      <p className="max-w-xs text-sm text-ink-muted">
        {filter === "current"
          ? "Create one from the circle home — your friends will see it the second you do."
          : "Plans land here after they finish or get cancelled."}
      </p>
    </section>
  );
}

// ---------- Helpers ----------

function headerAccent(filter: Filter): string {
  if (filter === "past") return "looking back.";
  // Time-of-day flavor for the editorial subhead. Doesn't need to be
  // pixel-perfect — the goal is the page feeling specific to right-now
  // rather than reading like a generic page title.
  const h = new Date().getHours();
  if (h < 5) return "after hours.";
  if (h < 12) return "this morning.";
  if (h < 17) return "this afternoon.";
  if (h < 21) return "tonight.";
  return "tonight.";
}

function statsLine({
  deciding,
  locked,
  past,
}: {
  deciding: number;
  locked: number;
  past: number;
}): string {
  const parts: string[] = [];
  if (deciding) parts.push(`${deciding} deciding`);
  if (locked) parts.push(`${locked} locked`);
  if (past) parts.push(`${past} past`);
  if (parts.length === 0) return "Nothing on the docket.";
  return parts.join(" · ");
}

type PlanWithDate = Omit<MyPlansPagePlan, "startsAt"> & { startsAt: Date };

type Bucket = { label: string; items: PlanWithDate[] };

function bucketPlans(
  plans: PlanWithDate[],
  now: Date,
  filter: Filter,
): Bucket[] {
  if (plans.length === 0) return [];

  // Past plans get a simpler split: today / earlier this week / earlier.
  if (filter === "past") {
    const today: PlanWithDate[] = [];
    const week: PlanWithDate[] = [];
    const earlier: PlanWithDate[] = [];
    for (const p of plans) {
      const d = daysDiff(p.startsAt, now);
      if (d <= 0) today.push(p);
      else if (d < 7) week.push(p);
      else earlier.push(p);
    }
    return [
      today.length ? { label: "Today", items: today } : null,
      week.length ? { label: "This week", items: week } : null,
      earlier.length ? { label: "Earlier", items: earlier } : null,
    ].filter((b): b is Bucket => b !== null);
  }

  // Current plans: tonight, tomorrow, this week, later.
  const tonight: PlanWithDate[] = [];
  const tomorrow: PlanWithDate[] = [];
  const week: PlanWithDate[] = [];
  const later: PlanWithDate[] = [];
  for (const p of plans) {
    const d = daysDiff(p.startsAt, now);
    if (d === 0) tonight.push(p);
    else if (d === 1) tomorrow.push(p);
    else if (d < 7) week.push(p);
    else later.push(p);
  }
  return [
    tonight.length ? { label: tonightLabel(now), items: tonight } : null,
    tomorrow.length ? { label: "Tomorrow", items: tomorrow } : null,
    week.length ? { label: "This week", items: week } : null,
    later.length ? { label: "Later", items: later } : null,
  ].filter((b): b is Bucket => b !== null);
}

// "Tonight" reads odd at 9am; pick by current hour. Same flavor as the
// home page so the user feels like the app is tracking with them.
function tonightLabel(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Today";
  if (h < 17) return "This afternoon";
  return "Tonight";
}

function daysDiff(target: Date, ref: Date): number {
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(target) - startOf(ref)) / 86_400_000);
}

function toUpcomingRowData(plan: PlanWithDate): UpcomingRowData {
  return {
    id: plan.id,
    title: plan.title,
    type: plan.type,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    isApproximate: plan.isApproximate,
    location: plan.location,
    status: plan.status,
  };
}
