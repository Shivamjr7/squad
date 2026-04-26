import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
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
