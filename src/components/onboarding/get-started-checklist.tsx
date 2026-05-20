import Link from "next/link";
import { type ReactNode } from "react";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Replaces OrbitalEmptyState on a brand-new circle home — gives new
// users a concrete "here's what to do" track instead of a "tap +"
// hint. Step completion is derived from real data:
//
//   1. Circle created — always done (you're here)
//   2. Invite friends — done when memberCount > 1
//   3. Propose first plan — always pending in the empty state, since
//      a single plan would flip the page out of isEmpty entirely
//
// No localStorage / DB flag for completion — the data IS the state.

type Props = {
  // First name for the greeting headline. Falls back to "you".
  firstName: string;
  memberCount: number;
  slug: string;
  // The page already constructs `NewPlanTrigger mode="cta"` for other
  // empty-state slots; pass it through so the checklist doesn't have
  // to duplicate the dialog wiring.
  planSlot: ReactNode;
};

export function GetStartedChecklist({
  firstName,
  memberCount,
  slug,
  planSlot,
}: Props) {
  const inviteDone = memberCount > 1;

  return (
    <article className="relative overflow-hidden rounded-[24px] border border-ink/8 bg-paper-card p-5 shadow-card sm:p-6">
      {/* Faint coral glow upper-right — same warmth treatment as the
          Spotlight hero so the empty state feels like part of the same
          surface family, not a placeholder card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-coral/15 blur-[60px] dark:bg-coral/25"
      />

      <header className="relative flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-coral">
          <Sparkles className="size-3" aria-hidden />
          Get started
        </span>
        <h2 className="font-serif text-[26px] leading-tight font-semibold text-ink sm:text-[28px]">
          You&rsquo;re set up, {firstName}.
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Two quick things and your squad is live.
        </p>
      </header>

      <ul className="relative mt-5 flex flex-col gap-2">
        <Step done label="Created your circle" />
        <Step
          done={inviteDone}
          label={inviteDone ? "Squad has friends" : "Invite friends to join"}
          actionHref={inviteDone ? null : `/c/${slug}/squad`}
          actionLabel="Invite"
        />
        <Step
          done={false}
          label="Propose your first plan"
          highlighted
          action={planSlot}
        />
      </ul>
    </article>
  );
}

function Step({
  done,
  label,
  actionHref,
  actionLabel,
  action,
  highlighted,
}: {
  done: boolean;
  label: string;
  actionHref?: string | null;
  actionLabel?: string;
  // Custom action node (e.g. a NewPlanTrigger). Takes precedence over
  // actionHref so the page can hand-roll an inline trigger when the
  // step needs to open a dialog rather than navigate.
  action?: ReactNode;
  // Pull-focus tint for the next pending step the user should do.
  highlighted?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition-colors",
        done
          ? "border-ink/6 bg-ink/[0.025]"
          : highlighted
            ? "border-coral/25 bg-coral-soft/40"
            : "border-ink/8 bg-paper-card",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-in text-paper"
            : highlighted
              ? "border-2 border-coral/40 text-coral"
              : "border-2 border-ink/15 text-ink-muted",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[14.5px] font-medium leading-tight",
          done ? "text-ink-muted" : "text-ink",
        )}
      >
        {label}
      </span>
      {action ? (
        <span className="shrink-0">{action}</span>
      ) : actionHref ? (
        <Link
          href={actionHref}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
            highlighted
              ? "bg-coral text-white hover:bg-coral/90"
              : "bg-ink/[0.06] text-ink hover:bg-ink/[0.10]",
          )}
        >
          {actionLabel ?? "Open"}
          <ChevronRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}
