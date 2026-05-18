"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";

export type FilterCircle = {
  id: string;
  slug: string;
  name: string;
};

export type TimeFilter = "today" | "week" | "later";

const TIME_LABELS: Record<TimeFilter, string> = {
  today: "Today",
  week: "This week",
  later: "Later",
};

// Plans-tab filter strip. URL-driven (no local state) so the active
// filter survives back/forward navigation and shareable links work. All
// filters are additive — Clear filters strips them all at once.
export function PlansFilters({
  circles,
  needsVoteCount = 0,
}: {
  circles: FilterCircle[];
  // Total unvoted plans across the feed (before any filter narrows it).
  // Renders as a counter chip on the "Needs my vote" toggle when > 0.
  needsVoteCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  const params = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  );
  const circleSlug = params.get("circle");
  const time = params.get("time") as TimeFilter | null;
  const needsVote = params.get("needs") === "1";
  const locked = params.get("locked") === "1";
  const activeCount =
    (circleSlug ? 1 : 0) +
    (time ? 1 : 0) +
    (needsVote ? 1 : 0) +
    (locked ? 1 : 0);

  const push = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mutate(next);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  const setCircle = (slug: string | null) =>
    push((p) => {
      if (slug) p.set("circle", slug);
      else p.delete("circle");
    });
  const setTime = (t: TimeFilter | null) =>
    push((p) => {
      if (t) p.set("time", t);
      else p.delete("time");
    });
  const toggleNeeds = () =>
    push((p) => {
      if (needsVote) p.delete("needs");
      else p.set("needs", "1");
    });
  const toggleLocked = () =>
    push((p) => {
      if (locked) p.delete("locked");
      else p.set("locked", "1");
    });
  const clearAll = () =>
    push((p) => {
      p.delete("circle");
      p.delete("time");
      p.delete("needs");
      p.delete("locked");
    });

  const activeCircle = circles.find((c) => c.slug === circleSlug);

  return (
    <div
      // Sticky beneath the tab bar so filters stay reachable while
      // scrolling the feed. Backdrop blur keeps content readable through
      // the strip on long lists.
      className="sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-paper/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-paper/70 sm:-mx-6 sm:px-6"
    >
      {/* flex-wrap (not overflow-x-auto) — CSS implicitly couples
          overflow-x:auto to overflow-y:auto, which would clip the
          absolutely-positioned dropdown panels below the row. Wrapping
          keeps every pill reachable and dropdowns visible at any width. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* "Needs my vote" leads — it's the most-actioned filter, and the
            counter pulls the eye to it before any other choice. */}
        <Toggle
          active={needsVote}
          onClick={toggleNeeds}
          count={needsVoteCount}
        >
          Needs my vote
        </Toggle>
        <CircleDropdown
          circles={circles}
          activeCircle={activeCircle ?? null}
          onChange={setCircle}
        />
        <TimeDropdown active={time} onChange={setTime} />
        <Toggle active={locked} onClick={toggleLocked}>
          Locked
        </Toggle>
      </div>
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex w-fit items-center gap-1 text-xs text-coral-strong hover:underline"
        >
          <X className="size-3" aria-hidden />
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Optional counter chip rendered after the label (only when > 0). */
  count?: number;
}) {
  const showCount = typeof count === "number" && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
        active
          ? "border-coral bg-coral-soft text-coral-strong"
          : "border-ink-subtle bg-paper-card text-ink-muted hover:text-ink",
      )}
    >
      {active ? <Check className="size-3" aria-hidden /> : null}
      {children}
      {showCount ? (
        <span
          aria-label={`${count} need vote`}
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none",
            active
              ? "bg-coral text-white"
              : "bg-coral text-white",
          )}
        >
          {count! > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );
}

// Native <details>/<summary>-based dropdowns — zero JS state, keyboard-
// accessible, close on outside click via the [open] toggle. Tradeoff:
// no fancy positioning, but for a thin filter strip this is plenty.
function CircleDropdown({
  circles,
  activeCircle,
  onChange,
}: {
  circles: FilterCircle[];
  activeCircle: FilterCircle | null;
  onChange: (slug: string | null) => void;
}) {
  const label = activeCircle ? activeCircle.name : "All circles";
  return (
    <details className="group relative shrink-0">
      <summary
        className={cn(
          "inline-flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
          activeCircle
            ? "border-coral bg-coral-soft text-coral-strong"
            : "border-ink-subtle bg-paper-card text-ink-muted hover:text-ink",
        )}
      >
        {activeCircle ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              circleDotClass(activeCircle.id),
            )}
          />
        ) : null}
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown className="size-3" aria-hidden />
      </summary>
      <DropdownPanel>
        <DropdownItem
          active={!activeCircle}
          onSelect={() => onChange(null)}
        >
          All circles
        </DropdownItem>
        {circles.map((c) => (
          <DropdownItem
            key={c.id}
            active={activeCircle?.slug === c.slug}
            onSelect={() => onChange(c.slug)}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                circleDotClass(c.id),
              )}
            />
            <span className="truncate">{c.name}</span>
          </DropdownItem>
        ))}
      </DropdownPanel>
    </details>
  );
}

function TimeDropdown({
  active,
  onChange,
}: {
  active: TimeFilter | null;
  onChange: (t: TimeFilter | null) => void;
}) {
  const label = active ? TIME_LABELS[active] : "Any time";
  return (
    <details className="group relative shrink-0">
      <summary
        className={cn(
          "inline-flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
          active
            ? "border-coral bg-coral-soft text-coral-strong"
            : "border-ink-subtle bg-paper-card text-ink-muted hover:text-ink",
        )}
      >
        <span>{label}</span>
        <ChevronDown className="size-3" aria-hidden />
      </summary>
      <DropdownPanel>
        <DropdownItem active={!active} onSelect={() => onChange(null)}>
          Any time
        </DropdownItem>
        {(["today", "week", "later"] as const).map((t) => (
          <DropdownItem
            key={t}
            active={active === t}
            onSelect={() => onChange(t)}
          >
            {TIME_LABELS[t]}
          </DropdownItem>
        ))}
      </DropdownPanel>
    </details>
  );
}

function DropdownPanel({ children }: { children: React.ReactNode }) {
  // z-50 — sits above plan cards (z-auto) and the sticky filter strip
  // (z-20). max-h with overflow-y-auto means a long list of circles
  // scrolls within the panel instead of bleeding past the viewport.
  // Width: min 200 / max 280 so long circle names don't push the panel
  // off a narrow mobile screen.
  return (
    <div className="absolute left-0 top-full z-50 mt-1 max-h-[min(60vh,320px)] min-w-[200px] max-w-[280px] overflow-y-auto rounded-xl border border-ink-subtle bg-paper-elevated p-1 shadow-card-raised">
      {children}
    </div>
  );
}

function DropdownItem({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Closes the parent <details> via the synthetic click then triggers
      // the filter change. The toggleAttribute call is required because
      // <details> doesn't auto-close on inside clicks.
      onClick={(e) => {
        const details = (e.currentTarget as HTMLElement).closest("details");
        if (details) details.removeAttribute("open");
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
        active
          ? "bg-coral-soft text-coral-strong"
          : "text-ink hover:bg-paper-card",
      )}
    >
      {children}
      {active ? <Check className="ml-auto size-3" aria-hidden /> : null}
    </button>
  );
}
