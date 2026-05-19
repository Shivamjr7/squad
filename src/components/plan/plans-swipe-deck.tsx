"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Gamepad2,
  HelpCircle,
  Home,
  MapPin,
  RotateCcw,
  Sparkles,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import type { PlanType } from "@/lib/validation/plan";
import type { VoteStatus } from "@/lib/validation/vote";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { PlanCardData } from "./plan-card";
import { formatPlanTime } from "@/lib/format-plan-time";
import { HeroQuestion } from "@/components/ui/hero-question";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import { cn } from "@/lib/utils";

type DeckPlan = Omit<PlanCardData, "startsAt"> & { startsAt: Date };

type Props = {
  plans: DeckPlan[];
  slug: string;
  now: Date;
};

// Drag thresholds — distance past which a release commits a vote vs.
// snaps back. Tuned for a 380px viewport: ~28% of width feels intentional
// without rewarding accidental flicks.
const SWIPE_X_THRESHOLD = 100;
const SWIPE_Y_THRESHOLD = 80;
// How far to fling the card off-screen on commit. Just needs to clear the
// viewport bounds while the transition runs.
const EXIT_OFFSET = 600;
// Undo affordance window. Long enough to catch "wait, wrong direction"
// without piling up state for stale actions.
const UNDO_TIMEOUT_MS = 6_000;

type Drag = { x: number; y: number; active: boolean };
type ExitDir = "right" | "left" | "up" | null;
type UndoEntry = { planId: string; previous: VoteStatus | null };

export function PlansSwipeDeck({ plans, slug, now }: Props) {
  const { voters, currentUser } = useCircleVotes();

  // Lock the deck to whatever was unvoted at mount time. If we re-derived
  // it from voters on every render the top card would vanish mid-swipe as
  // Realtime caught up with the user's own vote — we want the deck order
  // to be stable for the session.
  const [deck] = useState<DeckPlan[]>(() =>
    plans.filter((p) => !hasVote(voters[p.id], currentUser.id)),
  );

  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<Drag>({ x: 0, y: 0, active: false });
  const [exit, setExit] = useState<ExitDir>(null);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Clear undo affordance after the window expires.
  useEffect(() => {
    if (!undo) return;
    undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS);
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [undo]);

  const total = deck.length;
  const top = deck[index] ?? null;
  const next = deck[index + 1] ?? null;
  const after = deck[index + 2] ?? null;

  // Reduced-motion users get button-only voting (no drag exit animation).
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const commitVote = useCallback(
    (planId: string, status: VoteStatus, dir: ExitDir) => {
      if (reducedMotion) {
        // Skip the exit animation entirely — just advance and fire.
        setIndex((i) => i + 1);
        setUndo({
          planId,
          previous:
            voters[planId]?.find((v) => v.userId === currentUser.id)?.status ??
            null,
        });
        void castVote({ planId, status }).catch((err) => {
          toast.error(
            err instanceof Error ? err.message : "Couldn't save vote.",
          );
        });
        return;
      }
      setExit(dir);
      // Wait for the exit transition to play before advancing — keeps the
      // card visually committing to its direction rather than vanishing
      // mid-flight. The transition is 220ms (see CSS below); we tail it
      // with a slight buffer for the next card to slide up.
      window.setTimeout(() => {
        setIndex((i) => i + 1);
        setDrag({ x: 0, y: 0, active: false });
        setExit(null);
        setUndo({
          planId,
          previous:
            voters[planId]?.find((v) => v.userId === currentUser.id)?.status ??
            null,
        });
      }, 240);
      void castVote({ planId, status }).catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save vote.",
        );
      });
    },
    [reducedMotion, voters, currentUser.id],
  );

  const onUndo = useCallback(() => {
    if (!undo) return;
    setIndex((i) => Math.max(0, i - 1));
    setUndo(null);
    void (async () => {
      try {
        if (undo.previous === null) {
          await removeVote({ planId: undo.planId });
        } else {
          await castVote({ planId: undo.planId, status: undo.previous });
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't undo vote.",
        );
      }
    })();
  }, [undo]);

  // Pointer-event handlers. We use Pointer Events (not Touch + Mouse) so
  // the same code path handles desktop drag, mobile touch, and stylus
  // without three branches.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!top || exit !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0, active: true });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current || !drag.active) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    setDrag({ x: dx, y: dy, active: true });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!top || !startRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer wasn't captured (e.g. canceled) — safe to ignore.
    }
    const { x, y } = drag;
    startRef.current = null;

    if (x > SWIPE_X_THRESHOLD) {
      commitVote(top.id, "in", "right");
    } else if (x < -SWIPE_X_THRESHOLD) {
      commitVote(top.id, "out", "left");
    } else if (y < -SWIPE_Y_THRESHOLD) {
      commitVote(top.id, "maybe", "up");
    } else {
      // Below threshold — spring back to center.
      setDrag({ x: 0, y: 0, active: false });
    }
  };

  // Keyboard equivalents for the deck — accessibility + power-user.
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (exit !== null) return;
      if (e.key === "ArrowRight") commitVote(top.id, "in", "right");
      else if (e.key === "ArrowLeft") commitVote(top.id, "out", "left");
      else if (e.key === "ArrowUp") commitVote(top.id, "maybe", "up");
      else if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, exit, commitVote, onUndo]);

  if (total === 0) {
    return <AllCaughtUp slug={slug} />;
  }

  if (!top) {
    // Reached the end of the deck.
    return (
      <AllCaughtUp
        slug={slug}
        message="You've worked through every plan waiting on you."
      />
    );
  }

  // Translate + rotate the top card based on drag offset. Rotation is
  // damped (x / 20) so the card tilts subtly rather than spinning. Exit
  // animations replace the drag transform entirely.
  const topTransform = (() => {
    if (exit === "right") {
      return `translate(${EXIT_OFFSET}px, ${drag.y}px) rotate(20deg)`;
    }
    if (exit === "left") {
      return `translate(-${EXIT_OFFSET}px, ${drag.y}px) rotate(-20deg)`;
    }
    if (exit === "up") {
      return `translate(${drag.x}px, -${EXIT_OFFSET}px) rotate(0deg)`;
    }
    if (drag.active) {
      return `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 20}deg)`;
    }
    return "translate(0, 0) rotate(0)";
  })();

  const overlay: { tone: "in" | "out" | "maybe"; opacity: number } | null = (() => {
    if (drag.x > 20) {
      return { tone: "in", opacity: Math.min(1, drag.x / SWIPE_X_THRESHOLD) };
    }
    if (drag.x < -20) {
      return {
        tone: "out",
        opacity: Math.min(1, -drag.x / SWIPE_X_THRESHOLD),
      };
    }
    if (drag.y < -20) {
      return { tone: "maybe", opacity: Math.min(1, -drag.y / SWIPE_Y_THRESHOLD) };
    }
    return null;
  })();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      {/* Header — DECIDE · n/total */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/c/${slug}`}
          className="-ml-2 inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          aria-label="Back to circle"
        >
          ←
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Decide · {index + 1} / {total}
        </span>
        <span className="size-9" aria-hidden />
      </div>

      <HeroQuestion
        as="h2"
        size="md"
        prefix="Are you in for"
        accent={top.title}
        suffix="?"
      />

      {/* Deck stack — 3 cards. The top card responds to pointer events;
          the two behind are scale + offset for the depth illusion. */}
      <div
        className="relative h-[440px] select-none"
        aria-roledescription="swipe deck"
        aria-live="polite"
      >
        {after ? (
          <div className="absolute inset-0 origin-top scale-[0.92] opacity-50">
            <DeckCardSurface plan={after} now={now} />
          </div>
        ) : null}
        {next ? (
          <div className="absolute inset-0 origin-top scale-[0.96] opacity-80">
            <DeckCardSurface plan={next} now={now} />
          </div>
        ) : null}
        {/* Colored backlight — soft tinted glow under the top card,
            tracking the drag direction. Sits in the same absolute layer
            as the card but is rendered before the card div so it stacks
            beneath. Pure box-shadow so it doesn't add a paint layer. */}
        {overlay ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl"
            style={{
              boxShadow:
                overlay.tone === "in"
                  ? `0 0 80px 12px oklch(0.60 0.20 148 / ${overlay.opacity * 0.55})`
                  : overlay.tone === "out"
                    ? `0 0 80px 12px oklch(0.58 0.23 28 / ${overlay.opacity * 0.55})`
                    : `0 0 80px 12px oklch(0.80 0.18 78 / ${overlay.opacity * 0.55})`,
              transition:
                drag.active && exit === null
                  ? "none"
                  : "box-shadow 220ms ease-out",
            }}
          />
        ) : null}
        <div
          ref={cardRef}
          className="absolute inset-0 touch-none"
          style={{
            transform: topTransform,
            transition:
              drag.active && exit === null
                ? "none"
                : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <DeckCardSurface plan={top} now={now} overlay={overlay} />
        </div>
      </div>

      {/* Triplet — ✕ ? ✓ — explicit equivalents to the drag gestures.
          Out/Maybe sit at secondary size, In is the primary affordance
          (larger, stronger fill). Each has a visible label so the
          control reads as a vote action, not an abstract icon. */}
      <div className="flex items-end justify-center gap-6 pt-2">
        <CircleButton
          label="Out"
          onClick={() => commitVote(top.id, "out", "left")}
          tone="out"
        >
          <X className="size-5" aria-hidden strokeWidth={2.5} />
        </CircleButton>
        <CircleButton
          label="Maybe"
          onClick={() => commitVote(top.id, "maybe", "up")}
          tone="maybe"
        >
          <HelpCircle className="size-5" aria-hidden strokeWidth={2.25} />
        </CircleButton>
        <CircleButton
          label="In"
          onClick={() => commitVote(top.id, "in", "right")}
          tone="in"
          variant="primary"
        >
          <Check className="size-7" aria-hidden strokeWidth={2.5} />
        </CircleButton>
      </div>

      {undo ? (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex items-center gap-1.5 rounded-full bg-paper-card px-3 py-1.5 text-xs font-semibold text-ink-muted shadow-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Undo last vote
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeckCardSurface({
  plan,
  now,
  overlay,
}: {
  plan: DeckPlan;
  now: Date;
  overlay?: { tone: "in" | "out" | "maybe"; opacity: number } | null;
}) {
  const { voters } = useCircleVotes();
  const planVoters = voters[plan.id] ?? [];
  const inVoters = planVoters.filter((v) => v.status === "in");
  const whenLabel = formatPlanTime(
    plan.startsAt,
    plan.isApproximate,
    now,
    plan.timeZone,
  );
  const typeLabel = TYPE_LABEL[plan.type] ?? plan.type.toUpperCase();
  const tally = inVoters.length;

  const TypeIcon = TYPE_ICON[plan.type] ?? Sparkles;

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-ink/10 bg-paper-card shadow-card-raised">
      {/* Chip row */}
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          <TypeIcon className="size-3.5" aria-hidden strokeWidth={2} />
          {typeLabel}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          {whenLabel}
        </span>
      </div>

      {/* Title + location — the headline. Generous top space lets the
          serif breathe; nothing competes with it visually. */}
      <div className="flex flex-1 flex-col gap-2.5 px-6 pt-10">
        <h3 className="font-serif text-[34px] font-semibold leading-[1.04] tracking-[-0.02em] text-ink">
          {plan.title}
        </h3>
        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden strokeWidth={2} />
          <span className="line-clamp-1">
            {plan.location ?? "no spot yet"}
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-6 pb-6">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Who&rsquo;s in
            </span>
            <AvatarStack voters={inVoters} />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Votes
            </span>
            <span className="font-serif text-3xl leading-none text-ink tabular-nums">
              {tally}
              <span className="ml-1 align-baseline text-xs font-sans text-ink-muted">
                in
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Pass / In footer hint — quiet, just a reminder of what each
          swipe direction commits to. */}
      <div className="grid grid-cols-2 border-t border-ink/8">
        <span className="flex items-center justify-center gap-1.5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          <ArrowLeft className="size-3" aria-hidden strokeWidth={2} />
          Pass
        </span>
        <span className="flex items-center justify-center gap-1.5 border-l border-ink/8 py-3.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          In
          <ArrowRight className="size-3" aria-hidden strokeWidth={2} />
        </span>
      </div>

      {/* Drag-direction overlay — fades a colored wash + label over the
          card so the user gets immediate feedback on what their drag
          would commit. Hidden on the stacked cards behind. */}
      {overlay ? (
        <div
          aria-hidden
          className={
            "pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-bold uppercase tracking-wider " +
            (overlay.tone === "in"
              ? "bg-in/15 text-in-strong"
              : overlay.tone === "out"
                ? "bg-out/15 text-out"
                : "bg-maybe/15 text-maybe-strong")
          }
          style={{ opacity: overlay.opacity }}
        >
          {overlay.tone === "in"
            ? "IN"
            : overlay.tone === "out"
              ? "PASS"
              : "MAYBE"}
        </div>
      ) : null}
    </article>
  );
}

function AvatarStack({
  voters,
}: {
  voters: { userId: string; displayName: string; avatarUrl: string | null }[];
}) {
  const shown = voters.slice(0, 4);
  if (shown.length === 0) {
    return <span className="text-sm text-ink-muted">No one yet</span>;
  }
  return (
    <span className="flex -space-x-1.5">
      {shown.map((v) => (
        <GradientAvatar
          key={v.userId}
          seed={v.userId}
          name={v.displayName}
          src={v.avatarUrl}
          size="md"
          className="ring-2 ring-paper-card"
        />
      ))}
    </span>
  );
}

function CircleButton({
  label,
  onClick,
  tone,
  variant = "secondary",
  children,
}: {
  label: string;
  onClick: () => void;
  tone: "in" | "out" | "maybe";
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}) {
  // Secondary = soft tint, primary = saturated fill. The In button is
  // the only primary in the triplet so the "yes" affordance reads first.
  const primaryToneClass =
    tone === "in"
      ? "bg-in text-paper ring-in/25 shadow-[0_8px_24px_-8px_oklch(0.60_0.20_148/0.55)] hover:bg-in/95"
      : tone === "out"
        ? "bg-out text-paper ring-out/25 shadow-[0_8px_24px_-8px_oklch(0.58_0.23_28/0.55)] hover:bg-out/95"
        : "bg-maybe text-ink ring-maybe/25 shadow-[0_8px_24px_-8px_oklch(0.80_0.18_78/0.55)] hover:bg-maybe/95";
  const secondaryToneClass =
    tone === "in"
      ? "bg-in-soft text-in-strong ring-in/15 hover:bg-in-soft/80"
      : tone === "out"
        ? "bg-out-soft text-out ring-out/15 hover:bg-out-soft/80"
        : "bg-maybe-soft text-maybe-strong ring-maybe/15 hover:bg-maybe-soft/80";
  const sizeClass = variant === "primary" ? "size-16" : "size-12";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex items-center justify-center rounded-full ring-1 ring-inset transition-all duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
          sizeClass,
          variant === "primary" ? primaryToneClass : secondaryToneClass,
        )}
      >
        {children}
      </button>
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.16em]",
          variant === "primary" ? "text-ink" : "text-ink-muted",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function AllCaughtUp({
  slug,
  message,
}: {
  slug: string;
  message?: string;
}) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-12 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Decide
      </span>
      <h3 className="font-serif text-2xl font-semibold text-ink">
        All caught up.
      </h3>
      <p className="max-w-xs text-sm text-ink-muted">
        {message ?? "Nothing waiting on your vote right now."}
      </p>
      <Link
        href={`/c/${slug}`}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        Back to circle
      </Link>
    </section>
  );
}

function hasVote(rows: { userId: string }[] | undefined, userId: string) {
  if (!rows) return false;
  return rows.some((r) => r.userId === userId);
}

const TYPE_LABEL: Record<PlanType, string> = {
  eat: "Eat",
  play: "Play",
  chai: "Chai",
  "stay-in": "Stay in",
  other: "Other",
};

const TYPE_ICON: Record<PlanType, LucideIcon> = {
  eat: UtensilsCrossed,
  play: Gamepad2,
  chai: Coffee,
  "stay-in": Home,
  other: Sparkles,
};

