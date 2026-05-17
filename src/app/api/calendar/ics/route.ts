import { auth } from "@clerk/nextjs/server";
import { getCalendarCommitments } from "@/lib/actions/conflicts";
import { buildIcsFeed, type IcsInput } from "@/lib/calendar";
import { getAppUrl } from "@/lib/url";
import { parseDateParam } from "@/components/calendar/calendar-date";

// M32.6 — one-shot ICS download covering every IN/MAYBE/creator-auto-in
// plan the user is on the hook for inside `[from, to)`. Not a live
// subscription feed: cookie auth only, so it's a manual export, not a
// webcal:// URL a calendar app polls in the background. True subscriptions
// would need per-user opaque tokens — out of scope per
// CONVERGENCE_PLAN.md §8 ("Calendar sync (Google / Apple). still a non-
// goal. ICS feed in M32.6 is one-way, manual subscribe only.").

const DEFAULT_WINDOW_DAYS = 60;
const MAX_WINDOW_DAYS = 366; // a year is plenty for a friend-group app

function clampWindow(from: Date, to: Date): { from: Date; to: Date } {
  if (from >= to) {
    const fallback = new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
    return { from, to: fallback };
  }
  const maxMs = MAX_WINDOW_DAYS * 86_400_000;
  if (to.getTime() - from.getTime() > maxMs) {
    return { from, to: new Date(from.getTime() + maxMs) };
  }
  return { from, to };
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const fromAnchor = rawFrom ? parseDateParam(rawFrom) : today;
  const toAnchor = rawTo
    ? parseDateParam(rawTo)
    : new Date(today.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
  const { from, to } = clampWindow(fromAnchor, toAnchor);

  const commitments = await getCalendarCommitments(from, to);

  const baseUrl = await getAppUrl();
  const events: IcsInput[] = commitments.map((c) => {
    const planUrl = `${baseUrl}/c/${c.circleSlug}/p/${c.planId}`;
    const description = `${c.circleName} · via Squad\n${planUrl}`;
    return {
      uid: c.planId,
      title: c.planTitle,
      startsAt: c.start,
      endsAt: c.end,
      location: c.location,
      description,
      url: planUrl,
    };
  });
  const ics = buildIcsFeed(events);

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="squad-calendar.ics"`,
      // No-store: the window changes per request and we never want a stale
      // cached snapshot served back when the user's commitments have moved.
      "Cache-Control": "no-store",
    },
  });
}
