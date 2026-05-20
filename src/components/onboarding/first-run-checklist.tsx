"use client";

import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateCircleForm } from "./create-circle-form";
import { JoinViaCodeForm } from "./join-via-code-form";

// First-run shell for /onboarding. Replaces the prior two-screen
// flow (chooser → form) with a single 3-step checklist that mirrors
// the GetStartedChecklist a user sees on /c/[slug] once they're in.
// Step 1 is actionable inline (chooser → create or join form). Steps
// 2 and 3 are previewed-only — they unlock automatically once the
// user lands on their new circle home.
//
// Existing users (memberships > 0) who reach this route to "Add
// another circle" don't see the checklist — the parent page renders
// the older CircleChooser instead. The checklist is specifically for
// first-time users so the same 3 step taxonomy holds end-to-end.

type Mode = "chooser" | "create" | "join";

export function FirstRunChecklist({
  firstName,
  initialMode = "chooser",
}: {
  firstName: string;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <article className="relative overflow-hidden rounded-[24px] border border-ink/8 bg-paper-card p-5 shadow-card sm:p-6">
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
          Welcome, {firstName}.
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Three quick steps and your squad is live.
        </p>
      </header>

      <ol className="relative mt-5 flex flex-col gap-2">
        <Step
          state="active"
          index={1}
          label="Create a circle or join with link"
        >
          {mode === "chooser" ? (
            <div className="flex flex-col gap-2 pt-3">
              <button
                type="button"
                onClick={() => setMode("create")}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-coral px-4 text-sm font-semibold text-white transition-colors hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                Create a circle
              </button>
              <button
                type="button"
                onClick={() => setMode("join")}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-ink/15 bg-paper-card px-4 text-sm font-semibold text-ink transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                Have an invite link?
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-3">
              <button
                type="button"
                onClick={() => setMode("chooser")}
                className="inline-flex items-center gap-1 self-start text-xs font-medium text-ink-muted hover:text-ink"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back
              </button>
              {mode === "create" ? <CreateCircleForm /> : <JoinViaCodeForm />}
            </div>
          )}
        </Step>

        <Step
          state="locked"
          index={2}
          label="Invite friends to your circle"
          hint="Unlocks once your circle is live."
        />
        <Step
          state="locked"
          index={3}
          label="Propose your first plan"
          hint="Unlocks once your circle is live."
        />
      </ol>
    </article>
  );
}

function Step({
  state,
  index,
  label,
  hint,
  children,
}: {
  state: "active" | "locked" | "done";
  index: number;
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "rounded-2xl border px-3.5 py-3 transition-colors",
        state === "active"
          ? "border-coral/25 bg-coral-soft/40"
          : state === "done"
            ? "border-ink/6 bg-ink/[0.025]"
            : "border-ink/8 bg-paper-card/60",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            state === "done"
              ? "bg-in text-paper"
              : state === "active"
                ? "border-2 border-coral/40 text-coral"
                : "border-2 border-ink/15 text-ink-muted",
          )}
        >
          {state === "done" ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : (
            index
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-[14.5px] font-medium leading-tight",
              state === "locked" ? "text-ink-muted" : "text-ink",
            )}
          >
            {label}
          </div>
          {hint && state === "locked" ? (
            <div className="mt-0.5 text-[11.5px] text-ink-muted">{hint}</div>
          ) : null}
        </div>
        {state === "locked" ? (
          <ChevronRight
            className="size-4 shrink-0 text-ink/20"
            aria-hidden
          />
        ) : null}
      </div>
      {children}
    </li>
  );
}
