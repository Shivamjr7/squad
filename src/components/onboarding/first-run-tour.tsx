"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

type TourRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
};

export type FirstRunTourStep = {
  title: string;
  body: string;
  selectors: string[];
};

const TOUR_VERSION = "v3";

const CIRCLE_STEPS: FirstRunTourStep[] = [
  {
    title: "Start a plan",
    body: "The + button opens the plan sheet. Choose who it is for, set the time and place, then send it to the circle.",
    selectors: ['[data-tour="new-plan"]'],
  },
  {
    title: "Find everything else",
    body: "Home is plans, Calendar is what is coming up, Squad is invites and members, and You has profile plus notification controls.",
    selectors: ['[data-tour="primary-nav"]'],
  },
];

function getVisibleTourTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const targets = document.querySelectorAll<HTMLElement>(selector);
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      const style = window.getComputedStyle(target);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0";

      if (visible) return target;
    }
  }

  return null;
}

export function FirstRunTour({
  userId,
  tourId = "circle",
  steps = CIRCLE_STEPS,
}: {
  userId: string;
  tourId?: string;
  steps?: FirstRunTourStep[];
}) {
  const storageKey = useMemo(
    () => `squad_first_run_tour_seen:${userId}:${tourId}:${TOUR_VERSION}`,
    [tourId, userId],
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);

  const activeStep = activeIndex === null ? null : steps[activeIndex];
  const isLast = activeIndex === steps.length - 1;

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Best-effort. If storage is blocked, the user can still dismiss for
      // this page view; a future load may show the tour again.
    }
  }, [storageKey]);

  const dismiss = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    markSeen();
    setActiveIndex(null);
  }, [markSeen]);

  useEffect(() => {
    const forceTour =
      new URLSearchParams(window.location.search).get("tour");

    if (forceTour === "1" || forceTour === tourId) {
      const timer = window.setTimeout(() => setActiveIndex(0), 300);
      return () => window.clearTimeout(timer);
    }

    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (seen) return;

    const timer = window.setTimeout(() => setActiveIndex(0), 700);
    return () => window.clearTimeout(timer);
  }, [storageKey, tourId]);

  useEffect(() => {
    if (!activeStep) return;
    const step = activeStep;

    function updateRect() {
      const target = getVisibleTourTarget(step.selectors);

      if (!target) {
        setRect(null);
        return;
      }

      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      const next = target.getBoundingClientRect();
      const targetStyle = window.getComputedStyle(target);
      const targetRadius = parseFloat(targetStyle.borderTopLeftRadius);
      const padding = target.dataset.tour === "home-add-circle" ? 5 : 9;
      setRect({
        top: next.top - padding,
        left: next.left - padding,
        width: next.width + padding * 2,
        height: next.height + padding * 2,
        radius: Number.isFinite(targetRadius)
          ? targetRadius + padding
          : Math.max(18, Math.min(999, (next.height + padding * 2) / 2)),
      });
    }

    updateRect();
    const timers = [100, 300, 700, 1200].map((delay) =>
      window.setTimeout(updateRect, delay),
    );
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [activeStep]);

  useEffect(() => {
    if (activeIndex === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, dismiss]);

  function next() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setActiveIndex((current) => {
      if (current === null) return current;
      if (current >= steps.length - 1) {
        markSeen();
        return null;
      }
      return current + 1;
    });
  }

  if (!activeStep || activeIndex === null) return null;

  return (
    <div aria-live="polite">
      <div className="pointer-events-none fixed inset-0 z-50 bg-ink/20 backdrop-blur-[1px]" />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] border-[3px] border-coral bg-coral/10 shadow-[0_0_0_9999px_rgba(12,12,12,0.18),0_0_0_7px_rgba(239,91,79,0.20),0_10px_30px_-14px_rgba(239,91,79,0.95)] transition-all duration-200"
          style={{
            top: Math.max(8, rect.top),
            left: Math.max(8, rect.left),
            width: rect.width,
            height: rect.height,
            borderRadius: rect.radius,
          }}
        />
      ) : null}

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-tour-title"
        className="fixed inset-x-3 z-[70] mx-auto max-w-sm rounded-[22px] border border-ink/10 bg-paper-card p-4 text-left shadow-[0_18px_50px_-16px_rgba(0,0,0,0.45)] bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] md:bottom-6 md:left-48 md:right-auto md:mx-0 md:w-[21rem]"
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-coral">
              Quick tour {activeIndex + 1}/{steps.length}
            </div>
            <h2
              id="first-run-tour-title"
              className="text-[18px] font-semibold leading-tight text-ink"
            >
              {activeStep.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
            aria-label="Dismiss tour"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {activeStep.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((step, index) => (
              <span
                key={step.title}
                className={cn(
                  "size-1.5 rounded-full",
                  index === activeIndex ? "bg-coral" : "bg-ink/15",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1 rounded-full bg-coral px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
            >
              {isLast ? (
                <>
                  Done
                  <Check className="size-3.5" aria-hidden />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="size-3.5" aria-hidden />
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
