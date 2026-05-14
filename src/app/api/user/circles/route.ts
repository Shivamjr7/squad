import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserCircles } from "@/lib/circles";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const circles = await getUserCircles(userId);
    
    // Add cache headers for better performance
    const response = NextResponse.json(circles);
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    response.headers.set("Vary", "Authorization");
    
    return response;
  } catch (error) {
    console.error("Error fetching user circles:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
