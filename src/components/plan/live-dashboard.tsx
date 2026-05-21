"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, MessageCircle } from "lucide-react";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import { cn } from "@/lib/utils";

// Plan Detail · C — "Live Dashboard". Cockpit for active plans with a
// decide-by deadline. Consensus ring + countdown, squad grid, AI nudge,
// sticky RSVP bar.
//
// Built on semantic tokens (`bg-paper-card`, `text-ink`, `var(--in)`, …)
// so the whole surface flips cleanly between the light and dark themes
// without parallel palettes — white card on cream paper in light mode,
// near-black card on near-black paper in dark mode. Coral / in / maybe
// brand colors flip through their own CSS variables.

export type LiveDashboardMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

type Props = {
  planId: string;
  planTitle: string;
  startsAt: Date;
  timeZone: string;
  location: string | null;
  decideBy: Date | null;
  recipientCount: number;
  lockThreshold: number;
  creatorId: string | null;
  circleName: string;
  // Recipient roster — every person eligible to vote. The grid renders
  // one tile per member so the squad section is populated before any
  // votes arrive. Status badge derives from the live voter context.
  squad: LiveDashboardMember[];
  shiftedFromTime: Date | null;
  now: Date;
  // True when the page also renders PlanCreatorActionBar (creator + admin
  // path). Used to lift the mobile sticky RSVP above the action bar so the
  // two fixed shelves don't overlap.
  hasActionBar?: boolean;
};

const COMMIT_DEBOUNCE_MS = 200;
const RING_R = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

function shortHourMinute(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
}

function shortDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  })
    .format(d)
    .toUpperCase();
}

export function LiveDashboard({
  planId,
  planTitle,
  startsAt,
  timeZone,
  location,
  decideBy,
  recipientCount,
  lockThreshold,
  creatorId,
  circleName,
  squad,
  shiftedFromTime,
  now: serverNow,
  hasActionBar = false,
}: Props) {
  const { voters, currentUser } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

  // Index voter status by userId so the grid can colour each tile in O(1).
  // Creators are implicit IN per server policy — surface that even before
  // they cast an explicit row.
  const statusByUser = useMemo(() => {
    const map = new Map<string, VoteStatus>();
    for (const v of planVoters) map.set(v.userId, v.status);
    if (creatorId && !map.has(creatorId)) map.set(creatorId, "in");
    return map;
  }, [planVoters, creatorId]);

  const counts = useMemo(() => {
    let inN = 0;
    let maybeN = 0;
    let outN = 0;
    // Iterate the recipient roster — same source the grid renders from —
    // so the ring and the tiles can never disagree.
    for (const m of squad) {
      const s = statusByUser.get(m.userId);
      if (s === "in") inN += 1;
      else if (s === "maybe") maybeN += 1;
      else if (s === "out") outN += 1;
    }
    return { in: inN, maybe: maybeN, out: outN };
  }, [squad, statusByUser]);

  // Optimistic local override. Mirrors live-ticker's pattern: hold the
  // user's intent until the realtime row arrives, then clear.
  const [pendingVote, setPendingVote] = useState<VoteStatus | null | undefined>(
    undefined,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canonicalVote =
    planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;

  useEffect(() => {
    if (pendingVote === undefined) return;
    if (canonicalVote === pendingVote) setPendingVote(undefined);
  }, [canonicalVote, pendingVote]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const effectiveVote: VoteStatus | null =
    pendingVote !== undefined ? pendingVote : canonicalVote;

  const onVote = (next: VoteStatus | null) => {
    setPendingVote(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        try {
          if (next === null) await removeVote({ planId });
          else await castVote({ planId, status: next });
        } catch (err) {
          setPendingVote(undefined);
          toast.error(
            err instanceof Error ? err.message : "Couldn't save vote.",
          );
        }
      })();
    }, COMMIT_DEBOUNCE_MS);
  };

  // Countdown — refresh every second so HH:MM:SS feels alive. Skips the
  // interval entirely when there's no decideBy.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!decideBy) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [decideBy]);

  const countdown = useMemo(() => {
    if (!decideBy) return null;
    const ms = decideBy.getTime() - (serverNow.getTime() + tick * 1000);
    if (ms <= 0) return { h: "00", m: "00", s: "00", expired: true };
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec - h * 3600) / 60);
    const s = totalSec - h * 3600 - m * 60;
    return {
      h: String(h).padStart(2, "0"),
      m: String(m).padStart(2, "0"),
      s: String(s).padStart(2, "0"),
      expired: false,
    };
  }, [decideBy, serverNow, tick]);

  // Ring math — IN arc first (green), MAYBE second (amber). Stroke-dasharray
  // takes a "fill" length + an enormous gap. The MAYBE arc is offset by the
  // IN portion so they butt up without overlap.
  const inFrac =
    recipientCount > 0 ? Math.min(1, counts.in / recipientCount) : 0;
  const maybeFrac =
    recipientCount > 0 ? Math.min(1, counts.maybe / recipientCount) : 0;
  const inDash = inFrac * RING_CIRCUMFERENCE;
  const maybeDash = maybeFrac * RING_CIRCUMFERENCE;

  const remainingForLock = Math.max(0, lockThreshold - counts.in);

  const time = shortHourMinute(startsAt, timeZone);
  const dateLabel = shortDate(startsAt, timeZone);

  return (
    <article
      // Force dark surface regardless of app theme — this cockpit is a
      // feature card meant to read as a dark hero on every plan-detail
      // page (mirrors the home spotlight). The semantic tokens defined
      // under [data-theme="dark"] cascade from here, and `dark:`
      // utilities inside the subtree activate via the custom Tailwind
      // variant in globals.css.
      data-theme="dark"
      className="relative overflow-hidden rounded-[20px] bg-paper-card text-ink shadow-card-hero"
    >
      {/* Warm coral glow upper-right — pure decoration. Same intensity in
          both themes; coral itself flips its underlying token. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 size-60 rounded-full bg-coral/20 blur-[60px] dark:bg-coral/30"
      />

      <div className="relative flex flex-col gap-3 p-4 sm:p-5">
        {/* Hero card — ring + countdown side-by-side */}
        <div className="relative overflow-hidden rounded-[16px] border border-ink/8 bg-ink/[0.025] p-3.5 sm:p-4">
          <div className="flex items-center gap-3.5">
            <div className="relative size-[92px] shrink-0">
              <svg
                viewBox="0 0 100 100"
                className="size-full -rotate-90 text-ink/10"
                aria-hidden
              >
                {/* Track — uses currentColor so the ring background flips
                    with the theme via the SVG's own text-* class. */}
                <circle
                  cx="50"
                  cy="50"
                  r={RING_R}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={6}
                />
                {inDash > 0 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r={RING_R}
                    fill="none"
                    stroke="var(--in)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={`${inDash} ${RING_CIRCUMFERENCE}`}
                  />
                ) : null}
                {maybeDash > 0 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r={RING_R}
                    fill="none"
                    stroke="var(--maybe)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={`${maybeDash} ${RING_CIRCUMFERENCE}`}
                    strokeDashoffset={`${-inDash}`}
                  />
                ) : null}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-serif text-[30px] leading-none tracking-tight text-ink">
                  {counts.in}
                  <span className="text-[15px] text-ink-muted">
                    /{recipientCount}
                  </span>
                </div>
                <span className="mt-0.5 text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                  Consensus
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-coral">
                {countdown?.expired
                  ? "Locking now"
                  : decideBy
                    ? "Locks in"
                    : "Open"}
              </span>
              {countdown && !countdown.expired ? (
                <div className="mt-0.5 flex items-baseline gap-[2px] font-bold tabular-nums leading-none tracking-tight text-ink">
                  {countdown.h !== "00" ? (
                    <>
                      <span className="text-[26px]">{countdown.h}</span>
                      <span className="text-[26px] text-ink/30">:</span>
                    </>
                  ) : null}
                  <span className="text-[26px]">{countdown.m}</span>
                  <span className="text-[26px] text-ink/30">:</span>
                  <span className="text-[26px] text-coral">{countdown.s}</span>
                </div>
              ) : countdown?.expired ? (
                <div className="mt-0.5 text-[22px] font-bold text-coral">
                  00:00
                </div>
              ) : (
                <div className="mt-0.5 text-[20px] font-bold text-ink">
                  No deadline
                </div>
              )}
              <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
                Auto-locks at{" "}
                <b className="font-semibold text-ink">{lockThreshold} in</b>
                {decideBy ? (
                  <>
                    {" "}or{" "}
                    <b className="font-semibold text-ink">
                      {shortHourMinute(decideBy, timeZone)}
                    </b>
                    , whichever first.
                  </>
                ) : (
                  "."
                )}
              </p>
            </div>
          </div>

          {/* IN / MAYBE / OUT mini legend */}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink/8 pt-2.5">
            {[
              { n: counts.in, l: "In", color: "var(--in)" },
              { n: counts.maybe, l: "Maybe", color: "var(--maybe)" },
              { n: counts.out, l: "Out", color: "var(--out)" },
            ].map((r) => (
              <div key={r.l} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: r.color }}
                />
                <div className="min-w-0">
                  <div className="text-[15px] font-bold leading-none tabular-nums text-ink">
                    {r.n}
                  </div>
                  <div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                    {r.l}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Title + meta strip */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-ink-muted">
            {circleName} · {dateLabel}
          </span>
          <h1
            className="text-[19px] font-bold leading-tight tracking-tight text-ink"
            style={{ viewTransitionName: `plan-title-${planId}` }}
          >
            {planTitle}
            {location ? (
              <>
                {" "}
                <span className="font-serif text-[19px] font-normal italic text-coral">
                  at {location}
                </span>
              </>
            ) : null}
          </h1>
          <div className="mt-0.5 grid grid-cols-3 overflow-hidden rounded-xl border border-ink/8 bg-ink/[0.025]">
            <MetaCell
              label="When"
              value={time}
              sub={
                shiftedFromTime
                  ? `was ${shortHourMinute(shiftedFromTime, timeZone).toLowerCase()}`
                  : null
              }
            />
            <MetaCell
              label="Where"
              value={location ?? "TBD"}
              valueMuted={!location}
              border
            />
            <MetaCell
              label="Goal"
              value={`${lockThreshold} in`}
              sub={
                remainingForLock > 0
                  ? `${remainingForLock} more`
                  : "threshold met"
              }
              border
            />
          </div>
        </div>

        {/* Squad grid */}
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-ink">
              Squad
            </span>
            <span className="text-[8.5px] font-medium uppercase tracking-[0.11em] text-ink-muted">
              {squad.length} {squad.length === 1 ? "person" : "people"}
            </span>
          </div>
          <div
            className={cn(
              "grid gap-1.5",
              squad.length <= 8 ? "grid-cols-4" : "grid-cols-6",
            )}
          >
            {squad.map((m) => (
              <SquadTile
                key={m.userId}
                member={m}
                status={statusByUser.get(m.userId) ?? null}
                isYou={m.userId === currentUser.id}
                youCurrent={
                  m.userId === currentUser.id ? effectiveVote : null
                }
              />
            ))}
          </div>
        </section>

      </div>

      {/* Sticky RSVP — every recipient (creators included) can change their
          vote. When the page also mounts PlanCreatorActionBar (creator +
          admin), `hasActionBar` lifts the mobile sticky above it so the two
          fixed shelves don't overlap. On desktop (md+) StickyRSVP falls
          inline below the cockpit, no overlap either way. */}
      <StickyRSVP
        effectiveVote={effectiveVote}
        onVote={onVote}
        raised={hasActionBar}
      />
    </article>
  );
}

function MetaCell({
  label,
  value,
  sub,
  border,
  valueMuted,
}: {
  label: string;
  value: string;
  sub?: string | null;
  border?: boolean;
  valueMuted?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-2.5 py-2",
        border && "border-l border-ink/8",
      )}
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </span>
      <div
        className={cn(
          "mt-0.5 truncate text-[14px] font-bold leading-tight tracking-tight tabular-nums",
          valueMuted ? "text-ink-muted" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 truncate text-[10px] text-ink-muted">{sub}</div>
      ) : null}
    </div>
  );
}

const STATUS_CONFIG: Record<
  VoteStatus,
  { color: string; char: string; aria: string }
> = {
  in: { color: "var(--in)", char: "✓", aria: "In" },
  maybe: { color: "var(--maybe)", char: "?", aria: "Maybe" },
  out: { color: "var(--out)", char: "×", aria: "Out" },
};

function SquadTile({
  member,
  status,
  isYou,
  youCurrent,
}: {
  member: LiveDashboardMember;
  status: VoteStatus | null;
  isYou: boolean;
  youCurrent: VoteStatus | null;
}) {
  // The "You" tile mirrors the optimistic local vote so the user sees
  // their own change instantly, not just after realtime catches up.
  const effective = isYou ? youCurrent ?? status : status;
  const cfg = effective ? STATUS_CONFIG[effective] : null;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2",
        isYou
          ? "border-coral/40 bg-coral/10"
          : "border-ink/8 bg-ink/[0.035]",
      )}
    >
      <div className="relative">
        <GradientAvatar
          seed={member.userId}
          name={member.displayName}
          src={member.avatarUrl}
          size="md"
          className={cn(
            "ring-2",
            isYou ? "ring-coral" : "ring-paper-card",
          )}
        />
        {cfg ? (
          <span
            aria-label={cfg.aria}
            // Outline (not box-shadow) gives the badge a "moat" cut into
            // the avatar that flips with the paper-card surface in both
            // themes — no theme-specific shadow tuning needed.
            className="absolute -bottom-0.5 -right-0.5 inline-flex size-[14px] items-center justify-center rounded-full text-[8px] font-bold text-white outline outline-2 outline-paper-card"
            style={{ background: cfg.color }}
          >
            {cfg.char}
          </span>
        ) : null}
      </div>
      <span className="max-w-full truncate text-[10px] font-medium text-ink">
        {isYou ? "You" : member.displayName.split(/\s+/)[0]}
      </span>
    </div>
  );
}

function StickyRSVP({
  effectiveVote,
  onVote,
  raised = false,
}: {
  effectiveVote: VoteStatus | null;
  onVote: (next: VoteStatus | null) => void;
  // When the PlanCreatorActionBar is also rendered, lift the sticky higher
  // so it sits above the Cancel | Mark as set buttons. The action bar's
  // buttons span ~56px above the +76px safe-area offset; add ~70px of
  // clearance so the two shelves don't crowd each other.
  raised?: boolean;
}) {
  const isIn = effectiveVote === "in";
  return (
    <div
      // Below md the bar floats fixed above the mobile tab bar; on md+ it
      // falls back to relative so it sits inline below the cockpit. The
      // mobile bottom offset has to live in a Tailwind class (not an inline
      // style) so `md:bottom-auto` can override it on desktop — inline
      // styles win specificity over media-query classes and would otherwise
      // shift the relative-positioned bar up over the squad grid.
      className={cn(
        "fixed inset-x-3 z-30 mx-auto flex max-w-2xl gap-1.5 rounded-[22px] border border-ink/10 bg-paper-card/95 p-2 shadow-[0_16px_36px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl md:relative md:inset-x-auto md:mt-4 md:bottom-auto",
        raised
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)+146px)]"
          : "bottom-[calc(env(safe-area-inset-bottom,0px)+76px)]",
      )}
    >
      <RSVPButton
        label={isIn ? "You're in" : "I'm in"}
        status="in"
        active={isIn}
        onClick={() => onVote(isIn ? null : "in")}
      />
      <RSVPButton
        label="Maybe"
        status="maybe"
        active={effectiveVote === "maybe"}
        onClick={() => onVote(effectiveVote === "maybe" ? null : "maybe")}
      />
      <RSVPButton
        label="Can't"
        status="out"
        active={effectiveVote === "out"}
        onClick={() => onVote(effectiveVote === "out" ? null : "out")}
      />
    </div>
  );
}

// One shared button shape for all three RSVP slots. Equal width, equal
// height; the only thing that changes is the active fill, which uses the
// semantic vote token (`bg-in` / `bg-maybe` / `bg-out`) so each state reads
// its own color when selected. Inactive treatment is identical across all
// three so the user never has to guess which one is "primary."
function RSVPButton({
  label,
  status,
  active,
  onClick,
}: {
  label: string;
  status: VoteStatus;
  active: boolean;
  onClick: () => void;
}) {
  const activeFill =
    status === "in"
      ? "border-transparent bg-in text-paper"
      : status === "maybe"
        ? "border-transparent bg-maybe text-ink"
        : "border-transparent bg-out text-paper";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border text-[13px] font-semibold tracking-tight text-ink transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
        active
          ? activeFill
          : "border-ink/10 bg-ink/[0.05] hover:bg-ink/[0.10]",
      )}
    >
      {active && status === "in" ? (
        <Check className="size-4" strokeWidth={2.4} aria-hidden />
      ) : null}
      {label}
    </button>
  );
}

// Re-export the chat link icon for parent surfaces that want to drop a
// matching "open chat" button next to the cockpit. Currently unused; kept
// alongside the cockpit for future composition.
export const LiveDashboardChatIcon = MessageCircle;
