import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, plans, votes } from "@/db/schema";
import { getCircleBySlug } from "@/lib/circles";

export async function GET(
  _request: unknown,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const circle = await getCircleBySlug(slug);
    if (!circle) {
      return NextResponse.json({ error: "Circle not found" }, { status: 404 });
    }

    // Get member IDs for this circle in a single query
    const memberIds = await db
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.circleId, circle.id));
    
    if (memberIds.length === 0) {
      return NextResponse.json([]);
    }

    const userIds = memberIds.map(m => m.userId);

    // Get last activity using indexed queries (batch into small chunks)
    const chunkSize = 100;
    const allActivity: Array<{ userId: string | null; lastActive: Date | null }> = [];
    
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      
      const [voteActivity, planActivity] = await Promise.all([
        db
          .select({ 
            userId: votes.userId, 
            lastActive: max(votes.votedAt).as('lastActive')
          })
          .from(votes)
          .innerJoin(plans, eq(votes.planId, plans.id))
          .where(
            and(
              eq(plans.circleId, circle.id), 
              inArray(votes.userId, chunk)
            )
          )
          .groupBy(votes.userId),
        db
          .select({ 
            userId: plans.createdBy, 
            lastActive: max(plans.createdAt).as('lastActive')
          })
          .from(plans)
          .where(
            and(
              eq(plans.circleId, circle.id),
              inArray(plans.createdBy, chunk)
            )
          )
          .groupBy(plans.createdBy),
      ]);

      allActivity.push(...voteActivity, ...planActivity);
    }

    // Merge and deduplicate
    const activityByUser = new Map<string, Date>();
    
    for (const activity of allActivity) {
      if (activity.userId && activity.lastActive) {
        const current = activityByUser.get(activity.userId);
        if (!current || activity.lastActive > current) {
          activityByUser.set(activity.userId, activity.lastActive);
        }
      }
    }

    // Convert to array format
    const activityArray = Array.from(activityByUser.entries()).map(([userId, lastActive]) => ({
      userId,
      lastActive: lastActive.toISOString(),
    }));

    const response = NextResponse.json(activityArray);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    response.headers.set("Vary", "Authorization");
    response.headers.set("CDN-Cache-Control", "max-age=15");
    
    return response;
  } catch (error) {
    console.error("Error fetching circle activity:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
