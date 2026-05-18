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
import { Check, HelpCircle, RotateCcw, X } from "lucide-react";
import type { PlanType } from "@/lib/validation/plan";
import type { VoteStatus } from "@/lib/validation/vote";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { PlanCardData } from "./plan-card";
import { formatPlanTime } from "@/lib/format-plan-time";
import { HeroQuestion } from "@/components/ui/hero-question";
import { GradientAvatar } from "@/components/ui/gradient-avatar";

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

      {/* Triplet — ✕ ? ✓ — explicit equivalents to the drag gestures. */}
      <div className="flex items-center justify-center gap-6 pt-1">
        <CircleButton
          label="Out"
          onClick={() => commitVote(top.id, "out", "left")}
          tone="out"
        >
          <X className="size-6" aria-hidden />
        </CircleButton>
        <CircleButton
          label="Maybe"
          onClick={() => commitVote(top.id, "maybe", "up")}
          tone="maybe"
        >
          <HelpCircle className="size-6" aria-hidden />
        </CircleButton>
        <CircleButton
          label="In"
          onClick={() => commitVote(top.id, "in", "right")}
          tone="in"
        >
          <Check className="size-6" aria-hidden />
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

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-ink/5 bg-paper-card shadow-card-raised">
      {/* Type stripe / hero band — pulls a soft diagonal pattern that
          plays the role the venue photo plays in the M21 venue-vote mock.
          Mock #1 uses a beige diagonal pattern; we mirror that with a
          gradient so we don't ship an extra image. */}
      <div
        className="relative flex h-44 shrink-0 items-start justify-between gap-3 p-4"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--paper) 0 12px, var(--paper-card) 12px 24px)",
        }}
      >
        <span className="rounded-full bg-paper-card/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
          {typeLabel}
        </span>
        <span className="rounded-full bg-paper-card/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
          {whenLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="font-serif text-2xl font-semibold leading-tight text-ink">
          {plan.title}
        </h3>
        <p className="line-clamp-1 text-sm text-ink-muted">
          {plan.location ?? "no spot yet"}
        </p>

        <div className="mt-auto grid grid-cols-2 gap-4 pt-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Votes
            </span>
            <span className="font-serif text-lg text-in-strong">
              {tally}
              <span className="ml-1 text-sm text-ink-muted">in</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Said yes
            </span>
            <AvatarStack voters={inVoters} />
          </div>
        </div>
      </div>

      {/* PASS / IN split footer */}
      <div className="grid grid-cols-2 border-t border-ink/10">
        <span className="py-3 text-center text-sm font-semibold tracking-wide text-out">
          ← Pass
        </span>
        <span className="py-3 text-center text-sm font-semibold tracking-wide text-in-strong border-l border-ink/10">
          In →
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
  children,
}: {
  label: string;
  onClick: () => void;
  tone: "in" | "out" | "maybe";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "in"
      ? "bg-in-soft text-in-strong"
      : tone === "out"
        ? "bg-out-soft text-out"
        : "bg-maybe-soft text-maybe-strong";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex size-14 items-center justify-center rounded-full transition-transform duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral ${toneClass}`}
    >
      {children}
    </button>
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
