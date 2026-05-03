import { Resend } from "resend";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  comments,
  memberships,
  plans,
  users,
  votes,
} from "@/db/schema";
import {
  newCommentTemplate,
  newPlanTemplate,
  planCancelledTemplate,
  planConfirmedTemplate,
  type EmailContent,
} from "@/lib/email-templates";

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
      with: { user: { columns: { email: true } } },
    });
    const recipients = memberRows
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
      with: { user: { columns: { email: true } } },
    });
    const recipients = voterRows
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
      with: { user: { columns: { email: true } } },
    });
    const recipients = memberRows
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
      with: { user: { columns: { email: true } } },
    });
    const recipients = voterRows
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
