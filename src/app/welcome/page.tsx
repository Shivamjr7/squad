import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { getMostRecentCircleSlug, requireDisplayNameSet } from "@/lib/auth";
import { WelcomeCta } from "@/components/pwa/welcome-cta";
import { SquadLogo } from "@/components/brand/squad-logo";

// M31.7 — single-purpose surface for the install moment. Reached three ways:
//   1. iOS Safari users on their first launch in standalone mode (the
//      redirector in (shell)/layout.tsx sends them here once).
//   2. Legacy users (installed before M31) who don't yet have a push
//      subscription row — same redirector, different localStorage flag.
//   3. Direct navigation from the install banner's notification step on
//      Android Chrome (rare — the banner usually handles permission inline).
// The page itself doesn't enforce standalone display-mode — that's the
// redirector's job. Hitting /welcome from a regular browser tab still works.
export default async function WelcomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/welcome");

  await requireDisplayNameSet(userId);

  const fallbackSlug = await getMostRecentCircleSlug(userId);
  // No circle yet → onboarding takes priority over notifications.
  if (!fallbackSlug) redirect("/onboarding");

  // Already subscribed somewhere? Skip the ask and just route them home.
  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1);
  if (existing.length > 0) redirect(`/c/${fallbackSlug}`);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-10 px-6 pb-24 pt-16 text-center">
      <SquadLogo className="size-8 text-ink" />
      <div className="flex flex-col gap-4">
        <span className="eyebrow text-ink-muted">One quick thing</span>
        <h1 className="font-serif text-[36px] leading-[1.05] font-semibold text-ink sm:text-[42px]">
          Don&apos;t miss the moment.
        </h1>
        <p className="text-sm leading-relaxed text-ink-muted sm:text-base">
          We&apos;ll ping you when a new plan drops, when one&apos;s about to
          lock, and 45 minutes before you should leave. Nothing else.
        </p>
      </div>
      <WelcomeCta fallbackSlug={fallbackSlug} />
    </main>
  );
}
