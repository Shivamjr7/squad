import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, plans, planRecipients } from "@/db/schema";
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

    // Check if user is member
    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.circleId, circle.id),
        eq(memberships.userId, userId)
      ),
    });

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const now = new Date();

    let upcomingPlans;
    
    if (isAdmin) {
      // Admins see all plans
      upcomingPlans = await db.query.plans.findMany({
        where: and(
          eq(plans.circleId, circle.id),
          inArray(plans.status, ["active", "confirmed"]),
          gte(plans.startsAt, now),
        ),
        orderBy: [
          sql`(${plans.status} = 'confirmed') desc`,
          asc(plans.startsAt),
        ],
        with: {
          creator: { 
            columns: { 
              id: true, 
              displayName: true, 
              avatarUrl: true 
            } 
          },
        },
      });
    } else {
      // Members see plans they're recipients of or plans with no recipients
      const visiblePlanIds = await db
        .selectDistinct({ id: plans.id })
        .from(plans)
        .leftJoin(
          planRecipients,
          eq(plans.id, planRecipients.planId)
        )
        .where(
          and(
            eq(plans.circleId, circle.id),
            inArray(plans.status, ["active", "confirmed"]),
            gte(plans.startsAt, now),
            sql`
              (${planRecipients.planId} IS NULL 
               OR ${planRecipients.userId} = ${userId})
            `
          )
        );

      const visibleIds = visiblePlanIds.map(p => p.id);
      upcomingPlans = visibleIds.length > 0
        ? await db.query.plans.findMany({
            where: inArray(plans.id, visibleIds),
            orderBy: [
              sql`(${plans.status} = 'confirmed') desc`,
              asc(plans.startsAt),
            ],
            with: {
              creator: { 
                columns: { 
                  id: true, 
                  displayName: true, 
                  avatarUrl: true 
                } 
              },
            },
          })
        : [];
    }

    const response = NextResponse.json(upcomingPlans);
    response.headers.set("Cache-Control", "private, max-age=20, stale-while-revalidate=60");
    response.headers.set("Vary", "Authorization");
    response.headers.set("CDN-Cache-Control", "max-age=10, stale-while-revalidate=30");
    
    return response;
  } catch (error) {
    console.error("Error fetching circle plans:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
