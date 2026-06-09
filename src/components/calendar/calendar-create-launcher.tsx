"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { FormMember } from "@/components/plan/new-plan-form";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";

const DESKTOP_QUERY = "(min-width: 640px)";

const NewPlanForm = dynamic(
  () =>
    import("@/components/plan/new-plan-form").then(
      (mod) => mod.NewPlanForm,
    ),
  { loading: () => <NewPlanFormLoading /> },
);

export type LauncherCircle = {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
  members: FormMember[];
};

type Props = {
  // Tap target the calendar surfaces hand back as a Date in viewer-local
  // wall-clock; the launcher serialises it to "YYYY-MM-DDTHH:mm" and feeds
  // NewPlanForm via its existing `initialStartsAtLocal` seam. When null the
  // launcher is closed.
  pickedDate: Date | null;
  onClose: () => void;
  circles: LauncherCircle[];
  currentUserId: string;
};

// Format a Date as the "YYYY-MM-DDTHH:mm" value expected by
// <input type="datetime-local"> — the same shape NewPlanForm uses for its
// `initialStartsAtLocal` prop. Matches the form's internal `toDateTimeLocal`
// helper so the prefilled value round-trips cleanly through the picker.
function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewPlanFormLoading() {
  return (
    <div className="flex h-full flex-col bg-paper px-5 py-6">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
        New plan
      </span>
      <div className="mt-8 flex flex-col gap-4">
        <div className="h-10 w-3/4 rounded-xl bg-ink/10" />
        <div className="h-11 rounded-xl bg-ink/10" />
        <div className="h-11 rounded-xl bg-ink/10" />
        <div className="h-24 rounded-2xl bg-ink/10" />
      </div>
    </div>
  );
}

export function CalendarCreateLauncher({
  pickedDate,
  onClose,
  circles,
  currentUserId,
}: Props) {
  const isOpen = pickedDate !== null;
  // Auto-pick the only circle so single-circle users skip the picker step.
  // When the user has multiple circles we leave this null on open and let
  // them pick — re-resets to null every time the launcher reopens so the
  // picker is honest about "you haven't chosen yet."
  const [chosenCircleId, setChosenCircleId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      // Reset the picker step when the sheet closes so the next pick starts
      // fresh. Single-circle users skip the step via the autoselect below.
      setChosenCircleId(null);
      return;
    }
    if (circles.length === 1) {
      setChosenCircleId(circles[0]!.id);
    }
  }, [isOpen, circles]);

  const initialStartsAtLocal = useMemo(
    () => (pickedDate ? toDateTimeLocal(pickedDate) : undefined),
    [pickedDate],
  );

  const chosenCircle = useMemo(
    () => circles.find((c) => c.id === chosenCircleId) ?? null,
    [chosenCircleId, circles],
  );

  const body =
    chosenCircle === null ? (
      <CirclePickerStep
        circles={circles}
        onPick={setChosenCircleId}
        onCancel={onClose}
      />
    ) : initialStartsAtLocal ? (
      <NewPlanForm
        circleId={chosenCircle.id}
        slug={chosenCircle.slug}
        members={chosenCircle.members}
        currentUserId={currentUserId}
        onDone={onClose}
        initialStartsAtLocal={initialStartsAtLocal}
      />
    ) : null;

  if (!mounted) return null;

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={(o) => (o ? null : onClose())}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "gap-0 overflow-hidden p-0",
            chosenCircle === null
              ? "max-w-sm"
              : "h-[min(720px,90vh)] max-w-lg grid-rows-[minmax(0,1fr)]",
          )}
        >
          <DialogTitle className="sr-only">
            {chosenCircle === null ? "Pick a circle" : "New plan"}
          </DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          "gap-0 p-0",
          chosenCircle === null ? "h-auto" : "h-[100dvh]",
        )}
      >
        <SheetTitle className="sr-only">
          {chosenCircle === null ? "Pick a circle" : "New plan"}
        </SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function CirclePickerStep({
  circles,
  onPick,
  onCancel,
}: {
  circles: LauncherCircle[];
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 bg-paper px-5 py-6">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
          New plan
        </span>
        <h2 className="font-serif text-2xl font-semibold leading-tight text-ink">
          Which circle?
        </h2>
        <p className="text-sm text-ink-muted">
          Pick where this plan belongs.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {circles.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="group flex w-full items-center gap-3 rounded-2xl border border-ink-subtle bg-paper-card p-3 text-left transition-colors hover:border-coral/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase text-white",
                  circleDotClass(c.id),
                )}
              >
                {c.name.trim()[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-ink">{c.name}</span>
                <span className="text-xs text-ink-muted">
                  {c.memberCount} {c.memberCount === 1 ? "person" : "people"}
                </span>
              </div>
              <ChevronRight
                className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
