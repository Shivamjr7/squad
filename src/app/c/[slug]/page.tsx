import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { NewPlanButton } from "@/components/circle/new-plan-button";
import { InviteButton } from "@/components/circle/invite-button";
import { PostJoinToast } from "@/components/circle/post-join-toast";

export default async function CircleHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const membership = await db.query.memberships.findFirst({
    columns: { role: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.circleId, circle.id),
    ),
  });
  // Privacy (PLAN.md §12): don't reveal a circle exists to non-members.
  if (!membership) notFound();

  const isAdmin = membership.role === "admin";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {circle.name}
        </h1>
        <div className="flex items-center gap-1">
          {isAdmin ? (
            <Button asChild variant="ghost" size="icon" aria-label="Settings">
              <Link href={`/c/${circle.slug}/settings`}>
                <Settings />
              </Link>
            </Button>
          ) : null}
          <UserButton />
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-base font-medium">No plans yet.</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          The first plan in this circle will be a moment.
        </p>
        {isAdmin ? (
          <div className="mt-6">
            <InviteButton circleId={circle.id} />
          </div>
        ) : null}
      </section>

      <NewPlanButton />
      <Suspense fallback={null}>
        <PostJoinToast />
      </Suspense>
    </main>
  );
}
