"use client";

import { useMemo, useState } from "react";
import { PlanCard, type PlanCardData } from "./plan-card";

export type MyPlansPagePlan = Omit<PlanCardData, "startsAt"> & {
  startsAt: string;
};

type Filter = "current" | "past";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "past", label: "Past" },
];

export function MyPlansPage({
  plans,
  slug,
}: {
  plans: MyPlansPagePlan[];
  slug: string;
}) {
  const [filter, setFilter] = useState<Filter>("current");

  const normalizedPlans = useMemo(
    () =>
      plans
        .map((plan) => ({
          ...plan,
          startsAt: new Date(plan.startsAt),
        }))
        .filter((plan) => !Number.isNaN(plan.startsAt.getTime())),
    [plans],
  );

  const now = useMemo(() => new Date(), []);

  const currentPlans = useMemo(
    () =>
      normalizedPlans
        .filter(
          (plan) =>
            plan.status !== "done" &&
            plan.status !== "cancelled" &&
            plan.startsAt >= now,
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    [normalizedPlans, now],
  );

  const pastPlans = useMemo(
    () =>
      normalizedPlans
        .filter(
          (plan) =>
            plan.status === "done" ||
            plan.status === "cancelled" ||
            plan.startsAt < now,
        )
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
    [normalizedPlans, now],
  );

  const visiblePlans = filter === "current" ? currentPlans : pastPlans;

  return (
    <div className="mx-auto min-h-screen w-full max-w-none px-4 py-6 pb-32 sm:px-6">
      <header className="flex flex-col gap-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            My plans
          </span>
          <h1 className="mt-2 text-3xl font-serif font-semibold tracking-tight text-ink sm:text-4xl">
            See your current and past plans
          </h1>
        </div>

        <div className="flex flex-wrap gap-2 rounded-full border border-ink/10 bg-paper p-1">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                filter === item.value
                  ? "bg-ink text-paper-card"
                  : "text-ink-muted hover:bg-paper-card"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {visiblePlans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-8 text-center">
            <p className="text-sm text-ink-muted">
              {filter === "current"
                ? "No current plans yet. Create one from the circle home."
                : "No past plans yet. Plans will move here after they finish or are cancelled."}
            </p>
          </div>
        ) : (
          visiblePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              slug={slug}
              now={plan.startsAt}
              hideVotes
            />
          ))
        )}
      </div>
    </div>
  );
}
