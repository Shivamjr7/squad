import { Resend } from "resend";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  comments,
  memberships,
  planRecipients,
  plans,
  users,
  votes,
} from "@/db/schema";
import {
  newCommentTemplate,
  newPlanTemplate,
  planCancelledTemplate,
  planConfirmedTemplate,
  planLockedTemplate,
  suggestStatsEmail,
  type EmailContent,
} from "@/lib/email-templates";
import { getSuggestStats } from "@/lib/suggest/stats";

// Best-effort transactional email. Every public function in this module
// catches its own errors — a downed Resend or revoked API key MUST NOT
// surface to the action that triggered the email. The DB write is the source
// of truth; an email that doesn't go out is a logged warning, never a 500.

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "Squad <onboarding@resend.dev>";
const TIME_ZONE = process.env.EMAIL_TIMEZONE || "UTC";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!RESEND_KEY) return null;
  if (!_resend) _resend = new Resend(RESEND_KEY);
  return _resend;
}

function devSubject(subject: string): string {
  return process.env.NODE_ENV === "production" ? subject : `[DEV] ${subject}`;
}

function notificationsUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/notifications`;
}

function planUrl(appUrl: string, slug: string, planId: string): string {
  return `${appUrl.replace(/\/$/, "")}/c/${slug}/p/${planId}`;
}

function formatPlanTimeForEmail(d: Date): string {
  // Format absolute datetime in EMAIL_TIMEZONE (defaults to UTC). The viewer's
  // local zone isn't available server-side; we accept that emails show one
  // chosen zone and the click-through to the app shows local time.
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TIME_ZONE,
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

async function sendOne({ to, subject, html, replyTo }: SendArgs): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set; skipping send", {
      to,
      subject,
    });
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: devSubject(subject),
      html,
      replyTo,
    });
    if (error) {
      console.error("[email] resend rejected", {
        to,
        subject,
        error: error.message ?? error,
      });
    }
  } catch (err) {
    console.error("[email] send threw", {
      to,
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendFanout(
  recipients: string[],
  content: EmailContent,
  replyTo?: string,
): Promise<void> {
  if (recipients.length === 0) return;
  await Promise.all(
    recipients.map((to) =>
      sendOne({ to, subject: content.subject, html: content.html, replyTo }),
    ),
  );
}

// M23 — fetch the explicit recipient set for a plan. null = no rows
// (back-compat: full circle). Caller intersects this with whatever audience
// it would otherwise email.
async function getRecipientUserIdSet(
  planId: string,
): Promise<Set<string> | null> {
  const rows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));
  if (rows.length === 0) return null;
  return new Set(rows.map((r) => r.userId));
}

export async function sendNewPlanEmail(
  planId: string,
  appUrl: string,
): Promise<void> {
  try {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: {
        creator: { columns: { id: true, displayName: true, email: true } },
        circle: { columns: { id: true, name: true, slug: true } },
      },
    });
    if (!plan || !plan.circle) return;

    const memberRows = await db.query.memberships.findMany({
      where: and(
        eq(memberships.circleId, plan.circle.id),
        plan.creator ? ne(memberships.userId, plan.creator.id) : undefined,
      ),
      with: { user: { columns: { id: true, email: true } } },
    });
    const recipientFilter = await getRecipientUserIdSet(planId);
    const recipients = memberRows
      .filter((m) =>
        recipientFilter === null ? true : m.user && recipientFilter.has(m.user.id),
      )
      .map((m) => m.user?.email)
      .filter((e): e is string => Boolean(e));

    const content = newPlanTemplate({
      planTitle: plan.title,
      circleName: plan.circle.name,
      planType: plan.type,
      planTimeFormatted: formatPlanTimeForEmail(plan.startsAt),
      location: plan.location,
      creatorName: plan.creator?.displayName ?? "Someone",
      planUrl: planUrl(appUrl, plan.circle.slug, plan.id),
      manageUrl: notificationsUrl(appUrl),
    });

    await sendFanout(recipients, content, plan.creator?.email);
  } catch (err) {
    console.error("[email] sendNewPlanEmail failed", {
      planId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendNewCommentEmail(
  commentId: string,
  appUrl: string,
): Promise<void> {
  try {
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      with: {
        user: { columns: { id: true, displayName: true, email: true } },
        plan: {
          columns: { id: true, title: true },
          with: { circle: { columns: { slug: true, name: true } } },
        },
      },
    });
    if (!comment || !comment.plan || !comment.plan.circle) return;

    const voterRows = await db.query.votes.findMany({
      where: and(
        eq(votes.planId, comment.plan.id),
        comment.user ? ne(votes.userId, comment.user.id) : undefined,
      ),
      with: { user: { columns: { id: true, email: true } } },
    });
    // Vote eligibility is restricted to recipients (M23), so voters are
    // already a subset — but we filter defensively here in case admins or
    // legacy votes from before the recipient set was tightened slipped in.
    const recipientFilter = await getRecipientUserIdSet(comment.plan.id);
    const recipients = voterRows
      .filter((v) =>
        recipientFilter === null ? true : v.user && recipientFilter.has(v.user.id),
      )
      .map((v) => v.user?.email)
      .filter((e): e is string => Boolean(e));

    const content = newCommentTemplate({
      commenterName: comment.user?.displayName ?? "Someone",
      commentBody: comment.body,
      planTitle: comment.plan.title,
      circleName: comment.plan.circle.name,
      planUrl: planUrl(appUrl, comment.plan.circle.slug, comment.plan.id),
      manageUrl: notificationsUrl(appUrl),
    });

    await sendFanout(recipients, content, comment.user?.email);
  } catch (err) {
    console.error("[email] sendNewCommentEmail failed", {
      commentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendPlanConfirmedEmail(
  planId: string,
  confirmerId: string,
  appUrl: string,
): Promise<void> {
  try {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: { circle: { columns: { slug: true, id: true, name: true } } },
    });
    if (!plan || !plan.circle) return;

    const confirmer = await db.query.users.findFirst({
      columns: { displayName: true, email: true },
      where: eq(users.id, confirmerId),
    });

    const memberRows = await db.query.memberships.findMany({
      where: and(
        eq(memberships.circleId, plan.circle.id),
        ne(memberships.userId, confirmerId),
      ),
      with: { user: { columns: { id: true, email: true } } },
    });
    const recipientFilter = await getRecipientUserIdSet(plan.id);
    const recipients = memberRows
      .filter((m) =>
        recipientFilter === null ? true : m.user && recipientFilter.has(m.user.id),
      )
      .map((m) => m.user?.email)
      .filter((e): e is string => Boolean(e));

    const content = planConfirmedTemplate({
      planTitle: plan.title,
      circleName: plan.circle.name,
      planTimeFormatted: formatPlanTimeForEmail(plan.startsAt),
      location: plan.location,
      confirmerName: confirmer?.displayName ?? "Someone",
      planUrl: planUrl(appUrl, plan.circle.slug, plan.id),
      manageUrl: notificationsUrl(appUrl),
    });

    await sendFanout(recipients, content, confirmer?.email);
  } catch (err) {
    console.error("[email] sendPlanConfirmedEmail failed", {
      planId,
      confirmerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function formatPlanTimeShortForEmail(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TIME_ZONE,
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

// "It's happening" email sent when an open-time plan locks. Recipients are
// everyone in the circle who voted in/maybe on the plan, plus the creator
// (so they don't miss the lock event for their own plan).
export async function sendPlanLockedEmail(
  planId: string,
  appUrl: string,
): Promise<void> {
  try {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: { circle: { columns: { slug: true, id: true, name: true } } },
    });
    if (!plan || !plan.circle) return;

    // Recipients: every plan recipient (M23). Pre-M23 plans (no rows) fall
    // back to the full circle. Open-mode lock is the moment of truth — every
    // intended recipient hears about it, not just slot voters.
    const memberRows = await db.query.memberships.findMany({
      where: eq(memberships.circleId, plan.circle.id),
      with: { user: { columns: { id: true, email: true } } },
    });
    const recipientFilter = await getRecipientUserIdSet(plan.id);
    const recipients = memberRows
      .filter((m) =>
        recipientFilter === null ? true : m.user && recipientFilter.has(m.user.id),
      )
      .map((m) => m.user?.email)
      .filter((e): e is string => Boolean(e));

    const content = planLockedTemplate({
      planTitle: plan.title,
      circleName: plan.circle.name,
      planTimeShort: formatPlanTimeShortForEmail(plan.startsAt),
      planTimeFormatted: formatPlanTimeForEmail(plan.startsAt),
      location: plan.location,
      planUrl: planUrl(appUrl, plan.circle.slug, plan.id),
      manageUrl: notificationsUrl(appUrl),
    });

    await sendFanout(recipients, content);
  } catch (err) {
    console.error("[email] sendPlanLockedEmail failed", {
      planId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const SUGGEST_CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurants",
  cafe: "Cafés",
  movie: "Movies",
  event: "Events",
  indoor: "Indoor",
  outdoor: "Outdoor",
  short_trip: "Short trips",
};

// S8 — admin-only weekly Suggest summary. Caller (the pg_cron route)
// passes a window in days; we resolve the circle's admins, compute stats,
// and fan out one email per admin. Returns the count actually sent so the
// route can log totals without re-querying.
export async function sendSuggestStatsEmail(args: {
  circleId: string;
  appUrl: string;
  windowDays: number;
}): Promise<{ sent: number; impressions: number; skipped?: string }> {
  try {
    const circleRow = await db.query.circles.findFirst({
      columns: { id: true, name: true, slug: true },
      where: eq(circles.id, args.circleId),
    });
    if (!circleRow) return { sent: 0, impressions: 0, skipped: "no_circle" };

    const adminRows = await db.query.memberships.findMany({
      columns: { id: true },
      where: and(
        eq(memberships.circleId, args.circleId),
        eq(memberships.role, "admin"),
      ),
      with: { user: { columns: { email: true } } },
    });
    const recipients = adminRows
      .map((m) => m.user?.email)
      .filter((e): e is string => Boolean(e));
    if (recipients.length === 0) {
      return { sent: 0, impressions: 0, skipped: "no_admins" };
    }

    const since = new Date(
      Date.now() - args.windowDays * 24 * 60 * 60 * 1000,
    );
    const stats = await getSuggestStats({ circleId: args.circleId, since });
    if (stats.totalLogs === 0) {
      // No activity — don't spam admins with an empty summary.
      return { sent: 0, impressions: 0, skipped: "no_activity" };
    }

    const formatPct = (rate: number | null): string =>
      rate === null ? "—" : `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;

    const content = suggestStatsEmail({
      circleName: circleRow.name,
      windowLabel: `last ${args.windowDays} days`,
      acceptanceRate: formatPct(stats.acceptanceRate),
      rejectRate: formatPct(stats.rejectRate),
      emptyRate: formatPct(stats.emptyRate),
      lowConfidenceRate: formatPct(stats.lowConfidenceFallbackRate),
      impressions: stats.impressions,
      adds: stats.feedback.add,
      rejects: stats.feedback.reject,
      topCategories: stats.topCategories.map((c) => ({
        label: SUGGEST_CATEGORY_LABEL[c.category] ?? c.category,
        impressions: c.impressions,
        adds: c.adds,
      })),
      degradedByProvider: stats.degradedByProvider,
      statsUrl: `${args.appUrl.replace(/\/$/, "")}/c/${circleRow.slug}/stats`,
      manageUrl: notificationsUrl(args.appUrl),
    });

    await sendFanout(recipients, content);
    return { sent: recipients.length, impressions: stats.impressions };
  } catch (err) {
    console.error("[email] sendSuggestStatsEmail failed", {
      circleId: args.circleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: 0, impressions: 0, skipped: "errored" };
  }
}

export async function sendPlanCancelledEmail(
  planId: string,
  cancellerId: string,
  appUrl: string,
): Promise<void> {
  try {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: { circle: { columns: { slug: true, name: true } } },
    });
    if (!plan || !plan.circle) return;

    const canceller = await db.query.users.findFirst({
      columns: { displayName: true, email: true },
      where: eq(users.id, cancellerId),
    });

    const voterRows = await db.query.votes.findMany({
      where: and(
        eq(votes.planId, planId),
        inArray(votes.status, ["in", "maybe"]),
        ne(votes.userId, cancellerId),
      ),
      with: { user: { columns: { id: true, email: true } } },
    });
    const recipientFilter = await getRecipientUserIdSet(planId);
    const recipients = voterRows
      .filter((v) =>
        recipientFilter === null ? true : v.user && recipientFilter.has(v.user.id),
      )
      .map((v) => v.user?.email)
      .filter((e): e is string => Boolean(e));

    const content = planCancelledTemplate({
      cancellerName: canceller?.displayName ?? "Someone",
      planTitle: plan.title,
      circleName: plan.circle.name,
      planTimeFormatted: formatPlanTimeForEmail(plan.startsAt),
      planUrl: planUrl(appUrl, plan.circle.slug, plan.id),
      manageUrl: notificationsUrl(appUrl),
    });

    await sendFanout(recipients, content, canceller?.email);
  } catch (err) {
    console.error("[email] sendPlanCancelledEmail failed", {
      planId,
      cancellerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
