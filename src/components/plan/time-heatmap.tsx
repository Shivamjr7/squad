"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SlotVotesProvider,
  useSlotVotes,
  type InitialSlotVoter,
  type SlotMember,
} from "@/lib/realtime/use-slot-votes";

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
        slots={props.slots}
        lockThreshold={props.lockThreshold ?? 5}
      />
    </SlotVotesProvider>
  );
}

function HeatmapInner({
  slots,
  lockThreshold,
}: {
  slots: HeatmapSlot[];
  lockThreshold: number;
}) {
  const { count, isMine, toggle, pending } = useSlotVotes();

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
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_8px_24px_-12px_rgba(20,15,10,0.10)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
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
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => toggle(slot.id)}
              disabled={pending}
              aria-pressed={mine}
              aria-label={`${hourLabel(slot.startsAt)}, ${c} ${
                c === 1 ? "person" : "people"
              } free${mine ? ", you" : ""}`}
              className={cn(
                "flex aspect-[3/4] min-h-16 flex-col items-center justify-between rounded-lg border px-1 py-2 text-center transition-colors",
                isTop
                  ? "border-coral bg-coral text-paper-card"
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

      <p className="pt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Plan locks if {lockThreshold}+ converge on one hour
      </p>
    </section>
  );
}
