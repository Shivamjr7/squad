"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SlotVotesProvider,
  useSlotVotes,
  type InitialSlotVoter,
  type SlotMember,
} from "@/lib/realtime/use-slot-votes";
import { useMyHardCommitments } from "@/lib/use-hard-commitments";

export type HeatmapSlot = {
  id: string;
  // ISO string from the server. We parse client-side for label rendering so
  // each viewer sees the slot in their own time zone.
  startsAt: string;
};

const HOUR_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  hour12: true,
});

function hourLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // "8 PM" → "8" + "PM" split for layout (only AM/PM trailing if it's a
  // boundary). Keep it terse for narrow phone layouts.
  const parts = HOUR_FMT.formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return `${hour}${period.toLowerCase()}`;
}

type Props = {
  planId: string;
  slots: HeatmapSlot[];
  initialVoters: InitialSlotVoter[];
  members: Record<string, SlotMember>;
  currentUserId: string;
  lockThreshold?: number;
  // Each slot is fixed at 60 min (time_slots.duration_minutes default), so
  // the dot calc uses 60 unless we surface a column later.
  slotDurationMinutes?: number;
};

export function TimeHeatmap(props: Props) {
  return (
    <SlotVotesProvider
      planId={props.planId}
      slotIds={props.slots.map((s) => s.id)}
      initialVoters={props.initialVoters}
      members={props.members}
      currentUserId={props.currentUserId}
    >
      <HeatmapInner
        planId={props.planId}
        slots={props.slots}
        lockThreshold={props.lockThreshold ?? 5}
        slotDurationMinutes={props.slotDurationMinutes ?? 60}
      />
    </SlotVotesProvider>
  );
}

function HeatmapInner({
  planId,
  slots,
  lockThreshold,
  slotDurationMinutes,
}: {
  planId: string;
  slots: HeatmapSlot[];
  lockThreshold: number;
  slotDurationMinutes: number;
}) {
  const { count, isMine, toggle } = useSlotVotes();

  // M32.4 — Scenario 4 (CONVERGENCE_PLAN.md §4.3). Cover the slot range
  // ±slot-length so a commitment that brushes the first/last cell still
  // paints a dot. Skip when there are no slots — `[null, null]` short-
  // circuits the hook fetch.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (slots.length === 0) return { rangeStart: null, rangeEnd: null };
    const times = slots
      .map((s) => new Date(s.startsAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length === 0) return { rangeStart: null, rangeEnd: null };
    const padMs = slotDurationMinutes * 60_000;
    return {
      rangeStart: new Date(Math.min(...times) - padMs),
      rangeEnd: new Date(Math.max(...times) + padMs * 2),
    };
  }, [slots, slotDurationMinutes]);
  const { findOverlap } = useMyHardCommitments(rangeStart, rangeEnd, planId);

  const { topCount, totalVoters } = useMemo(() => {
    let top = 0;
    const all = new Set<string>();
    for (const s of slots) {
      const c = count(s.id);
      if (c > top) top = c;
    }
    return { topCount: top, totalVoters: all.size };
  }, [slots, count]);

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-ink-muted">
          Pick the hours you&apos;re free
        </span>
        {totalVoters > 0 ? (
          <span className="text-[11px] text-ink-muted">{topCount} max</span>
        ) : null}
      </div>

      <div
        role="group"
        aria-label="Time-slot heatmap"
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`,
        }}
      >
        {slots.map((slot) => {
          const c = count(slot.id);
          const mine = isMine(slot.id);
          const isTop = c > 0 && c === topCount;
          // Density 0..1 used to scale background alpha. Cap at 1 for visual.
          const density = topCount > 0 ? Math.min(1, c / topCount) : 0;
          const slotStart = new Date(slot.startsAt);
          const slotEnd = new Date(
            slotStart.getTime() + slotDurationMinutes * 60_000,
          );
          const conflict = Number.isNaN(slotStart.getTime())
            ? null
            : findOverlap(slotStart, slotEnd);
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => toggle(slot.id)}
              aria-pressed={mine}
              aria-label={`${hourLabel(slot.startsAt)}, ${c} ${
                c === 1 ? "person" : "people"
              } free${mine ? ", you" : ""}${
                conflict ? `, clashes with ${conflict.planTitle}` : ""
              }`}
              className={cn(
                "relative flex aspect-[3/4] min-h-16 flex-col items-center justify-between rounded-lg border px-1 py-2 text-center transition-colors",
                isTop
                  ? "border-coral bg-coral text-white"
                  : c > 0
                    ? "border-ink/15 text-ink"
                    : "border-ink/10 text-ink-muted",
                mine && !isTop && "ring-2 ring-coral ring-offset-1 ring-offset-paper-card",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
              style={
                !isTop && c > 0
                  ? {
                      backgroundColor: `color-mix(in oklch, var(--coral-soft) ${
                        Math.round(20 + density * 60)
                      }%, transparent)`,
                    }
                  : undefined
              }
            >
              {conflict ? (
                <span
                  aria-hidden
                  title={`Clashes with ${conflict.planTitle}`}
                  className={cn(
                    "absolute right-1 top-1 size-1.5 rounded-full",
                    // On top of the filled coral cell the dot needs to be
                    // white to stay visible.
                    isTop ? "bg-white" : "bg-coral",
                  )}
                />
              ) : null}
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {hourLabel(slot.startsAt)}
              </span>
              <span
                className={cn(
                  "font-serif text-2xl font-semibold leading-none",
                  c === 0 && "opacity-40",
                )}
              >
                {c}
              </span>
              <span className="text-[9px] uppercase tracking-wide opacity-80">
                {mine ? "you ✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <p className="pt-1 text-center eyebrow text-ink-muted">
        Plan locks if {lockThreshold}+ converge on one hour
      </p>
    </section>
  );
}
