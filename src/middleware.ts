import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, userAgent } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/invite/(.*)",
  "/api/webhooks/(.*)",
  "/offline",
  // Digital Asset Links — Android fetches this unauthenticated to verify the
  // TWA owns this domain. Without it the TWA shows a URL bar.
  "/.well-known/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Mobile users hitting / unauthenticated → straight to sign-in. Same
  // pattern X / Instagram / LinkedIn use on mobile web: the marketing
  // landing exists for desktop discovery, but on a phone the app's first
  // surface should be auth.
  if (req.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (!userId && userAgent(req).device.type === "mobile") {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      return NextResponse.redirect(url);
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
