"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, planRecipients, plans, votes } from "@/db/schema";

// M29 — resolve the set of users who must vote for a plan to count as
// "fully voted". Mirrors M23's eligibility rule: explicit `plan_recipients`
// rows when present, otherwise everyone currently in the circle. Membership
// rows are deleted when a user leaves the circle (PLAN.md §5), so absence
// already implies inactive — no soft-flag column needed.
export async function getEligibleVoters(planId: string): Promise<string[]> {
  const plan = await db.query.plans.findFirst({
    columns: { id: true, circleId: true },
    where: eq(plans.id, planId),
  });
  if (!plan) return [];

  const recipientRows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));

  if (recipientRows.length > 0) {
    return recipientRows.map((r) => r.userId);
  }

  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.circleId, plan.circleId));
  return memberRows.map((m) => m.userId);
}

// True iff every eligible voter has any `votes` row for the plan (in/out/
// maybe — value doesn't matter, presence does). Returns false for the empty
// eligibility set so a misconfigured plan can't trigger an auto-lock.
export async function allEligibleVotersHaveVoted(
  planId: string,
): Promise<boolean> {
  const eligible = await getEligibleVoters(planId);
  if (eligible.length === 0) return false;

  const votedRows = await db
    .select({ userId: votes.userId })
    .from(votes)
    .where(and(eq(votes.planId, planId), inArray(votes.userId, eligible)));

  const votedSet = new Set(votedRows.map((r) => r.userId));
  return eligible.every((id) => votedSet.has(id));
}
