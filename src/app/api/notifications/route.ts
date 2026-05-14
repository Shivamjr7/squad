import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUnreadCount } from "@/lib/actions/notifications";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const unreadCount = await getUnreadCount();
    
    const response = NextResponse.json({ 
      unreadCount,
      timestamp: new Date().toISOString()
    });
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    response.headers.set("Vary", "Authorization");
    
    return response;
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ 
      unreadCount: 0,
      timestamp: new Date().toISOString()
    });
  }
}
