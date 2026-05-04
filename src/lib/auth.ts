import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, users } from "@/db/schema";
import { ActionError } from "@/lib/actions/errors";

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

// Call from any signed-in server page. Redirects to /set-name if the user
// hasn't picked a real display name yet (Fix 2 / M17). Cheap one-row lookup.
export async function requireDisplayNameSet(userId: string): Promise<void> {
  const row = await db.query.users.findFirst({
    columns: { hasSetDisplayName: true },
    where: eq(users.id, userId),
  });
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
