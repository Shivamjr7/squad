"use client";

import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SlotVotesProvider,
  useSlotVotes,
  type InitialSlotVoter,
  type SlotMember,
} from "@/lib/realtime/use-slot-votes";

export type HeatmapSlot = {
  id: string;
  // ISO string from the server. Parsed client-side so each viewer sees
  // labels in their own time zone.
  startsAt: string;
};

const HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
});

const HOUR_MINUTE_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function slotLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.getMinutes() !== 0) {
    return HOUR_MINUTE_FMT.format(d).replace(/\s/g, "").toLowerCase();
  }
  const parts = HOUR_FMT.formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return `${hour}${period.toLowerCase()}`;
}

function bestTimeFormat(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

// "tonight" / "today" / day-of-week label for the best-time subline,
// based on the slot's local date relative to now.
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "today";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.getHours() >= 17 ? "tonight" : "today";
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    return "tomorrow";
  }
  return d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
}

type Props = {
  planId: string;
  slots: HeatmapSlot[];
  initialVoters: InitialSlotVoter[];
  members: Record<string, SlotMember>;
  currentUserId: string;
  lockThreshold?: number;
  // Each slot is fixed at 60 min (time_slots.duration_minutes default).
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
        slots={props.slots}
        members={props.members}
        currentUserId={props.currentUserId}
        lockThreshold={props.lockThreshold ?? 5}
      />
    </SlotVotesProvider>
  );
}

function HeatmapInner({
  slots,
  members,
  currentUserId,
  lockThreshold,
}: {
  slots: HeatmapSlot[];
  members: Record<string, SlotMember>;
  currentUserId: string;
  lockThreshold: number;
}) {
  const { state, toggle } = useSlotVotes();

  // Member order: current user first, then alphabetical by display name.
  // Keeps "You" pinned at the top so the interactive row is the easiest
  // one to find on a phone.
  const memberList = useMemo(() => {
    const list = Object.values(members);
    list.sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return list;
  }, [members, currentUserId]);

  // Per-slot voter set lookup — direct read from the provider's state.
  const isVoted = (slotId: string, userId: string) =>
    state.slots.get(slotId)?.has(userId) ?? false;

  // Best slot = highest count; ties broken by earliest start. Surfaces
  // as the bottom "Best time" recommendation card.
  const { bestSlot, bestCount, perSlotCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let best: HeatmapSlot | null = null;
    let bestC = 0;
    let bestT = Infinity;
    for (const s of slots) {
      const c = state.slots.get(s.id)?.size ?? 0;
      counts.set(s.id, c);
      const t = new Date(s.startsAt).getTime();
      if (c > bestC || (c === bestC && c > 0 && t < bestT)) {
        best = s;
        bestC = c;
        bestT = t;
      }
    }
    return { bestSlot: best, bestCount: bestC, perSlotCount: counts };
  }, [slots, state.slots]);

  const totalMembers = memberList.length;
  const gridTemplate = `minmax(72px, auto) repeat(${slots.length}, minmax(0, 1fr))`;

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-paper-card p-5 shadow-card">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          When?
        </span>
        <h2 className="font-serif text-3xl font-semibold leading-[1.05] text-ink">
          When works for{" "}
          <em className="font-instrument-serif italic text-coral">everyone</em>
          ?
        </h2>
        <p className="text-sm text-ink-muted">
          Tap each hour you&apos;re free. We&apos;ll pick the time the most
          squad can make.
        </p>
      </div>

      <div
        role="grid"
        aria-label="Time-consensus availability grid"
        className="grid gap-x-2 gap-y-1.5"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* Header row — empty corner + hour labels */}
        <div aria-hidden />
        {slots.map((s) => (
          <div
            key={`hdr-${s.id}`}
            className="text-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
          >
            {slotLabel(s.startsAt)}
          </div>
        ))}

        {/* One row per member; current user is interactive, others read-only */}
        {memberList.map((m) => {
          const isOwn = m.userId === currentUserId;
          const initial = m.displayName.trim()[0]?.toUpperCase() ?? "?";
          return (
            <Fragment key={m.userId}>
              <div className="flex items-center gap-2 pr-1">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase text-white",
                    isOwn ? "bg-coral" : "bg-ink/70",
                  )}
                >
                  {initial}
                </span>
                <span className="truncate text-sm font-medium text-ink">
                  {isOwn ? "You" : m.displayName.split(" ")[0]}
                </span>
              </div>
              {slots.map((s) => {
                const voted = isVoted(s.id, m.userId);
                const isBest = bestSlot?.id === s.id && voted;
                return (
                  <button
                    key={`${m.userId}-${s.id}`}
                    type="button"
                    role="gridcell"
                    aria-selected={voted}
                    aria-label={`${m.displayName}, ${slotLabel(s.startsAt)}, ${
                      voted ? "free" : "not free"
                    }`}
                    onClick={isOwn ? () => toggle(s.id) : undefined}
                    disabled={!isOwn}
                    className={cn(
                      "aspect-square min-h-8 w-full rounded-md border transition-colors",
                      isBest
                        ? "border-coral bg-coral"
                        : voted
                          ? "border-ink bg-ink"
                          : "border-ink/10 bg-paper-card",
                      isOwn &&
                        "cursor-pointer hover:border-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
                      !isOwn && "cursor-default",
                    )}
                  />
                );
              })}
            </Fragment>
          );
        })}

        {/* Totals row — "FREE  1  3  5  5  4  2" */}
        <div className="pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Free
        </div>
        {slots.map((s) => {
          const c = perSlotCount.get(s.id) ?? 0;
          const isBest = bestSlot?.id === s.id && c > 0;
          return (
            <div
              key={`tot-${s.id}`}
              className={cn(
                "pt-3 text-center text-base font-semibold tabular-nums",
                isBest ? "text-coral" : "text-ink",
              )}
            >
              {c}
            </div>
          );
        })}
      </div>

      {/* Best-time recommendation card. Hidden when nobody's voted yet. */}
      {bestSlot && bestCount > 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-ink px-5 py-4 text-paper-card">
          <div className="flex items-baseline gap-4">
            <span className="font-serif text-3xl font-semibold leading-none tabular-nums">
              {bestTimeFormat(bestSlot.startsAt)}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                Best time {whenLabel(bestSlot.startsAt)}
              </span>
              <span className="text-xs text-paper-card/60">
                {bestCount}/{totalMembers} free
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Plan locks if {lockThreshold}+ converge on one hour
      </p>
    </section>
  );
}
