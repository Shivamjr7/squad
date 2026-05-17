import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCalendarCommitments } from "@/lib/actions/conflicts";
import { CalendarControls } from "@/components/calendar/calendar-controls";
import { CalendarPageClient } from "@/components/calendar/calendar-page-client";
import type { LauncherCircle } from "@/components/calendar/calendar-create-launcher";
import {
  formatDateParam,
  isCalendarView,
  parseDateParam,
  startOfDayLocal,
  windowForView,
  type CalendarView,
} from "@/components/calendar/calendar-date";
import { annotateConflicts } from "@/components/calendar/calendar-conflicts";
import {
  getCircleMembers,
  getUserCircles,
  type CircleMemberRow,
} from "@/lib/circles";
import type { FormMember } from "@/components/plan/new-plan-form";

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
  // userCircles is cached at the function level (lib/circles.ts), and
  // getCircleMembers fans out in parallel. For typical N=1-4 circles with
  // ~5-12 members each this is a handful of small queries — cheap enough to
  // do up-front so the create launcher's "Which circle?" + the form's
  // recipient chips are ready on first tap with no spinner.
  const [rawCommitments, userCircles] = await Promise.all([
    getCalendarCommitments(from, to),
    getUserCircles(userId),
  ]);
  const commitments = annotateConflicts(rawCommitments);

  const memberRowsByCircle = await Promise.all(
    userCircles.map(
      (c) => getCircleMembers(c.id) as Promise<CircleMemberRow[]>,
    ),
  );

  const launcherCircles: LauncherCircle[] = userCircles.map((c, i) => {
    const members: FormMember[] = (memberRowsByCircle[i] ?? [])
      .map((m) =>
        m.user
          ? {
              userId: m.user.id,
              displayName: m.user.displayName,
              avatarUrl: m.user.avatarUrl,
            }
          : null,
      )
      .filter((m): m is FormMember => m !== null);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      memberCount: c.memberCount,
      members,
    };
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6">
      <CalendarControls view={view} anchor={anchor} />

      <div className="mt-6">
        <CalendarPageClient
          view={view}
          anchor={anchor}
          todayKey={todayKey}
          commitments={commitments}
          circles={launcherCircles}
          currentUserId={userId}
        />
      </div>
    </main>
  );
}
