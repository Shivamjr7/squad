import { redirect } from "next/navigation";
import { unstable_cache as cache } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, planRecipients, users } from "@/db/schema";
import { ActionError } from "@/lib/actions/errors";

// Single broad tag — display-name flag flips at most once per user (on
// /set-name completion or the Clerk webhook), so invalidating every user's
// cache on a flip is cheap and correct.
export const USER_DISPLAY_NAME_TAG = "user-display-names";

export type MembershipRole = "admin" | "member";

export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new ActionError("UNAUTHORIZED", "You need to sign in first.");
  }
  return userId;
}

export async function getMembership(
  userId: string,
  circleId: string,
): Promise<{ role: MembershipRole } | null> {
  const row = await db.query.memberships.findFirst({
    columns: { role: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.circleId, circleId),
    ),
  });
  return row ?? null;
}

export async function requireMembership(
  circleId: string,
  requiredRole?: MembershipRole,
): Promise<{ userId: string; role: MembershipRole }> {
  const userId = await requireUserId();
  const m = await getMembership(userId, circleId);
  if (!m) {
    throw new ActionError("FORBIDDEN", "You're not a member of this circle.");
  }
  if (requiredRole === "admin" && m.role !== "admin") {
    throw new ActionError("FORBIDDEN", "Only admins can do this.");
  }
  return { userId, role: m.role };
}

// Cross-request cache for the display-name flag. Fired on every signed-in
// server page; the row only changes once (when the user completes /set-name)
// or via the Clerk webhook on signup. We invalidate via tag from those two
// write paths, so reads after the flip see truth immediately.
const getDisplayNameFlag = cache(
  async (userId: string): Promise<{ hasSetDisplayName: boolean } | null> => {
    const row = await db.query.users.findFirst({
      columns: { hasSetDisplayName: true },
      where: eq(users.id, userId),
    });
    return row ?? null;
  },
  ["user-display-name-flag"],
  // Long revalidate as a safety net; tag invalidation is the primary path.
  { revalidate: 300, tags: [USER_DISPLAY_NAME_TAG] },
);

// Call from any signed-in server page. Redirects to /set-name if the user
// hasn't picked a real display name yet (Fix 2 / M17). Cached read so the
// shell layout + page on the same request share one DB roundtrip across
// navigations.
export async function requireDisplayNameSet(userId: string): Promise<void> {
  const row = await getDisplayNameFlag(userId);
  // If the row doesn't exist yet (Clerk webhook in flight), don't block —
  // the user can still browse; the prompt will catch them next page load.
  if (row && !row.hasSetDisplayName) {
    redirect("/set-name");
  }
}

export async function getMostRecentCircleSlug(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ slug: circles.slug })
    .from(memberships)
    .innerJoin(circles, eq(memberships.circleId, circles.id))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.joinedAt))
    .limit(1);
  return rows[0]?.slug ?? null;
}

// Plan creator OR circle admin can mark done / cancel / uncancel
// (PLAN.md §6 Flow F). If the creator deleted their account, plans.created_by
// becomes NULL (§5 ON DELETE SET NULL) — only admins qualify in that case.
export function canModifyPlan(
  plan: { createdBy: string | null },
  userId: string,
  membership: { role: MembershipRole } | null,
): boolean {
  if (!membership) return false;
  if (membership.role === "admin") return true;
  return plan.createdBy !== null && plan.createdBy === userId;
}

// M23 — gate plan participation (vote, comment, suggest time/venue) on
// recipient set membership. Empty recipient set = full circle (back-compat),
// so anyone in the circle can participate. Otherwise: must be in the set.
// Admins are NOT auto-eligible — they self-add via the Squad section if they
// want to participate, matching the spec's vote eligibility rule.
export async function requirePlanRecipient(
  planId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));
  if (rows.length === 0) return; // implicit-full-circle
  if (rows.some((r) => r.userId === userId)) return;
  throw new ActionError(
    "FORBIDDEN",
    "You weren't invited to this plan.",
  );
}
