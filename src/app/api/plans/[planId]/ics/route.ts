import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, planRecipients, plans } from "@/db/schema";
import { buildIcs } from "@/lib/calendar";
import { getAppUrl } from "@/lib/url";

// M25 — generate the ICS body on the fly. Auth gate matches plan-detail:
// must be signed in, must be a circle member, and must be in the recipient
// set (or full-circle / admin). Calendar payload pulls plan title, starts_at,
// circle context, and a deep-link back to the plan.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ planId: string }> },
) {
  const { planId } = await ctx.params;
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
    with: {
      circle: { columns: { id: true, name: true, slug: true } },
    },
  });
  if (!plan) {
    return new Response("Not found", { status: 404 });
  }

  const m = await db.query.memberships.findFirst({
    columns: { role: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.circleId, plan.circle.id),
    ),
  });
  if (!m) {
    return new Response("Forbidden", { status: 403 });
  }

  if (m.role !== "admin") {
    const recipientRows = await db
      .select({ userId: planRecipients.userId })
      .from(planRecipients)
      .where(eq(planRecipients.planId, planId));
    if (
      recipientRows.length > 0 &&
      !recipientRows.some((r) => r.userId === userId)
    ) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const baseUrl = await getAppUrl();
  const planUrl = `${baseUrl}/c/${plan.circle.slug}/p/${plan.id}`;
  const description = `${plan.circle.name} · Plan locked via Squad\n${planUrl}`;
  const ics = buildIcs({
    uid: plan.id,
    title: plan.title,
    startsAt: plan.startsAt,
    location: plan.location,
    description,
    url: planUrl,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="squad-${plan.id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
