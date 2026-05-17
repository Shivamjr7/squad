import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCalendarCommitments } from "@/lib/actions/conflicts";
import { OrbitalEmptyState } from "@/components/plan/orbital-empty-state";
import { CalendarControls } from "@/components/calendar/calendar-controls";
import { WeekView } from "@/components/calendar/week-view";
import { DayView } from "@/components/calendar/day-view";
import { MonthView } from "@/components/calendar/month-view";
import {
  formatDateParam,
  isCalendarView,
  parseDateParam,
  startOfDayLocal,
  windowForView,
  type CalendarView,
} from "@/components/calendar/calendar-date";
import { annotateConflicts } from "@/components/calendar/calendar-conflicts";

export const metadata = {
  title: "Calendar — Squad",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) notFound();

  const sp = await searchParams;
  const view: CalendarView = isCalendarView(sp.view) ? sp.view : "week";
  const anchor = parseDateParam(sp.date);
  const todayKey = formatDateParam(startOfDayLocal(new Date()));

  const { from, to } = windowForView(view, anchor);
  const rawCommitments = await getCalendarCommitments(from, to);
  const commitments = annotateConflicts(rawCommitments);

  // We only want to show the orbital empty state when there's truly nothing
  // in the visible window — not just an empty current week. Month view's
  // grid is meaningful even with zero plans, so we still render the grid.
  const showEmpty =
    commitments.length === 0 && (view === "week" || view === "day");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6">
      <CalendarControls view={view} anchor={anchor} />

      <div className="mt-6">
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
          />
        ) : view === "day" ? (
          <DayView anchor={anchor} commitments={commitments} />
        ) : (
          <MonthView
            anchor={anchor}
            commitments={commitments}
            todayKey={todayKey}
          />
        )}
      </div>
    </main>
  );
}
