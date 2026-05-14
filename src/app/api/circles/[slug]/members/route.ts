import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCircleBySlug, getCircleMembers, type CircleMemberRow } from "@/lib/circles";

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

    const members = await getCircleMembers(circle.id) as CircleMemberRow[];
    type MemberWithUser = CircleMemberRow & {
      user: { id: string; displayName: string; avatarUrl: string | null };
    };

    // Transform to match expected format
    const transformedMembers = members
      .filter((m): m is MemberWithUser => Boolean(m.user))
      .map((m) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        joinedAt: m.joinedAt,
      }));
    
    const response = NextResponse.json(transformedMembers);
    response.headers.set("Cache-Control", "private, max-age=120, stale-while-revalidate=300");
    response.headers.set("Vary", "Authorization");
    
    return response;
  } catch (error) {
    console.error("Error fetching circle members:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
