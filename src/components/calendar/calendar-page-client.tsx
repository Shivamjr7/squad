"use client";

import { useState } from "react";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import {
  CalendarCreateLauncher,
  type LauncherCircle,
} from "./calendar-create-launcher";
import { OrbitalEmptyState } from "@/components/plan/orbital-empty-state";
import type { AnnotatedCommitment } from "./calendar-conflicts";
import type { CalendarView } from "./calendar-date";

type Props = {
  view: CalendarView;
  anchor: Date;
  todayKey: string;
  commitments: AnnotatedCommitment[];
  circles: LauncherCircle[];
  currentUserId: string;
};

// Owns the picked-date state so the create launcher is hoisted above all
// three views. Each view exposes an `onSlotPick(Date)` callback wired to
// `setPickedDate`. The launcher renders the chosen Sheet/Dialog and resets
// state on close.
export function CalendarPageClient({
  view,
  anchor,
  todayKey,
  commitments,
  circles,
  currentUserId,
}: Props) {
  const [pickedDate, setPickedDate] = useState<Date | null>(null);

  // Only surface create affordances when the user actually has somewhere to
  // create a plan. Zero-circle case is unreachable in practice (the home
  // redirect would have sent them to /onboarding), but we guard anyway.
  const canCreate = circles.length > 0;
  const onSlotPick = canCreate ? setPickedDate : undefined;

  // Empty state only when the user has no way to create on this view.
  // Before #2 the week/day views were read-only so a blank state was the
  // right pivot; with tap-to-create wired the grid itself IS the surface
  // (a freshly-redirected day-view from month is the obvious case — its
  // tap-target rail must show even with zero plans).
  const showEmpty =
    commitments.length === 0 && !canCreate && (view === "week" || view === "day");

  return (
    <>
      {showEmpty ? (
        <OrbitalEmptyState
          title="Nothing on the books."
          body="No plans you're in for in this window. Tap a circle to start one."
        />
      ) : view === "week" ? (
        <WeekView
          anchor={anchor}
          commitments={commitments}
          todayKey={todayKey}
          onSlotPick={onSlotPick}
        />
      ) : view === "day" ? (
        <DayView
          anchor={anchor}
          commitments={commitments}
          onSlotPick={onSlotPick}
        />
      ) : (
        // Month view stays read-only — tapping a cell navigates to that
        // day's view (where the per-hour create handles live).
        <MonthView
          anchor={anchor}
          commitments={commitments}
          todayKey={todayKey}
        />
      )}

      {canCreate ? (
        <CalendarCreateLauncher
          pickedDate={pickedDate}
          onClose={() => setPickedDate(null)}
          circles={circles}
          currentUserId={currentUserId}
        />
      ) : null}
    </>
  );
}
