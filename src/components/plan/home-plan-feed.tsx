"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, List } from "lucide-react";
import { CircleCollisionBanner } from "./circle-collision-banner";
import { SpotlightHero, type SpotlightHeroPlan } from "./spotlight-hero";
import { ThisWeekList, type ThisWeekListPlan } from "./this-week-list";
import type { PlanCardData } from "./plan-card";
import { cn } from "@/lib/utils";

const PlansSwipeDeck = dynamic(
  () => import("./plans-swipe-deck").then((mod) => mod.PlansSwipeDeck),
  { loading: () => <SwipeDeckLoading /> },
);

// Home's swipe deck shares PlanCardData shape with the deck used on
// /c/[slug]/plans — the deck itself doesn't read commentCount/creator, but
// the props type requires them.
export type HomeDeckPlan = Omit<PlanCardData, "startsAt"> & { startsAt: Date };

type Props = {
  featured: SpotlightHeroPlan | null;
  restPlans: ThisWeekListPlan[];
  deckPlans: HomeDeckPlan[];
  collision: { planAId: string; planBId: string } | null;
  circleName: string;
  slug: string;
  now: Date;
};

type ViewMode = "list" | "swipe";
const VIEW_STORAGE_KEY = "squad.home.view";

// List/Swipe toggle for the circle home. Default is the editorial
// spotlight + "This week" list; flipping to swipe converts everything into
// the same Tinder-style deck that used to live on /c/[slug]/plans, ordered
// by the same attention rank computed server-side.
export function HomePlanFeed({
  featured,
  restPlans,
  deckPlans,
  collision,
  circleName,
  slug,
  now,
}: Props) {
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "list" || stored === "swipe") setView(stored);
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

  // Toggle only earns its keep when there's more than one card to flip
  // between. With a single plan, both views collapse to the same surface.
  const hasMultiplePlans = deckPlans.length >= 2;

  return (
    <div className="flex flex-col gap-4">
      {hasMultiplePlans ? (
        <div className="flex justify-end">
          <ViewToggle value={view} onChange={setViewPersisted} />
        </div>
      ) : null}

      {view === "swipe" ? (
        <PlansSwipeDeck plans={deckPlans} slug={slug} now={now} context="home" />
      ) : (
        <div className="flex flex-col gap-6">
          {featured ? (
            <SpotlightHero
              plan={featured}
              circleName={circleName}
              slug={slug}
              now={now}
            />
          ) : null}

          {collision ? (
            <CircleCollisionBanner
              planAId={collision.planAId}
              planBId={collision.planBId}
            />
          ) : null}

          {restPlans.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-[20px] font-bold leading-tight tracking-tight text-ink">
                  This week
                </h3>
                <span className="text-[12px] font-medium text-ink-muted">
                  {restPlans.length}{" "}
                  {restPlans.length === 1 ? "plan" : "plans"}
                </span>
              </div>
              <ThisWeekList plans={restPlans} slug={slug} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SwipeDeckLoading() {
  return (
    <div className="flex min-h-[420px] flex-col justify-between rounded-[28px] border border-ink/10 bg-paper-card p-5 shadow-card">
      <div className="space-y-3">
        <div className="h-5 w-24 rounded-full bg-ink/10" />
        <div className="h-9 w-3/4 rounded-xl bg-ink/10" />
        <div className="h-5 w-1/2 rounded-xl bg-ink/10" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-11 rounded-2xl bg-ink/10" />
        <div className="h-11 rounded-2xl bg-ink/10" />
        <div className="h-11 rounded-2xl bg-ink/10" />
      </div>
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
        active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
