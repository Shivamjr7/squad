"use client";

// S6 — Home-page entry point for Suggest Plan. Replaces the previous
// QuickNudge card on the circle home (mobile inline + desktop right rail).
// Tapping the panel opens the SuggestDrawer; tapping Add inside the drawer
// opens the NewPlanForm pre-filled with the chosen venue label.
//
// We deliberately handle the new-plan-form here rather than delegating to
// NewPlanTrigger so the suggest flow stays self-contained — the suggest
// drawer never lives "inside" the create-plan button.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SuggestDrawer } from "@/components/plan/suggest-drawer";
import {
  NewPlanForm,
  type FormMember,
  type InitialSuggestion,
} from "@/components/plan/new-plan-form";

const DESKTOP_QUERY = "(min-width: 640px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

type Props = {
  circleId: string;
  slug: string;
  members: FormMember[];
  currentUserId: string;
};

type PrefilledPlan = {
  location: string;
  startsAtLocal: string;
  suggestion: InitialSuggestion;
};

export function SuggestPanel({
  circleId,
  slug,
  members,
  currentUserId,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefilled, setPrefilled] = useState<PrefilledPlan | null>(null);
  const isDesktop = useIsDesktop();

  return (
    <>
      <section
        aria-labelledby="suggest-panel-heading"
        className="rounded-3xl border border-coral/20 bg-coral-soft/40 p-4 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-coral/20 text-coral">
            <Sparkles className="size-3.5" aria-hidden />
          </span>
          <h2
            id="suggest-panel-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-coral"
          >
            Suggest a plan
          </h2>
        </div>
        <p className="mt-3 font-serif text-lg leading-tight text-ink">
          Not sure where to go?
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          We&apos;ll pick a few spots nearby based on tonight&apos;s vibe.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper-card transition hover:bg-ink/90"
          >
            Show me picks
          </button>
        </div>
      </section>

      <SuggestDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        circleId={circleId}
        onPickVenue={({ label, startsAtLocal, itemId, suggestionLogId }) => {
          setPrefilled({
            location: label,
            startsAtLocal,
            suggestion: { label, itemId, suggestionLogId },
          });
        }}
      />

      {/* Pre-filled new-plan dialog/sheet. Reuses the same responsive split
          NewPlanTrigger has so the form looks identical to the regular FAB
          flow — the only difference is WHERE is already populated. */}
      {prefilled !== null ? (
        isDesktop ? (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setPrefilled(null);
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="h-[min(720px,90vh)] max-w-lg gap-0 overflow-hidden p-0"
            >
              <DialogTitle className="sr-only">New plan</DialogTitle>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                members={members}
                currentUserId={currentUserId}
                initialLocation={prefilled.location}
                initialStartsAtLocal={prefilled.startsAtLocal}
                initialSuggestion={prefilled.suggestion}
                onDone={() => setPrefilled(null)}
              />
            </DialogContent>
          </Dialog>
        ) : (
          <Sheet
            open
            onOpenChange={(open) => {
              if (!open) setPrefilled(null);
            }}
          >
            <SheetContent
              side="bottom"
              showCloseButton={false}
              className="h-[100dvh] gap-0 p-0"
            >
              <SheetTitle className="sr-only">New plan</SheetTitle>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                members={members}
                currentUserId={currentUserId}
                initialLocation={prefilled.location}
                initialStartsAtLocal={prefilled.startsAtLocal}
                initialSuggestion={prefilled.suggestion}
                onDone={() => setPrefilled(null)}
              />
            </SheetContent>
          </Sheet>
        )
      ) : null}
    </>
  );
}
