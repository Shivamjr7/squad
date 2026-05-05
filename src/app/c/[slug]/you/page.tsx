import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { EditDisplayName } from "@/components/circle/edit-display-name";
import { LeaveCircleButton } from "@/components/circle/leave-circle-button";
import { YouSignOutButton } from "@/components/circle/sign-out-button";
import { getUserCircles } from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";

export default async function YouPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const [me, membership, userCircles] = await Promise.all([
    db.query.users.findFirst({
      columns: { displayName: true, email: true },
      where: eq(users.id, userId),
    }),
    db.query.memberships.findFirst({
      columns: { role: true },
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.circleId, circle.id),
      ),
    }),
    getUserCircles(userId),
  ]);
  if (!me || !membership) notFound();

  const isAdmin = membership.role === "admin";

  // Last-admin check: if I'm an admin and there are no other admins, leaving
  // would orphan the circle. Block it on the client + server.
  let isLastAdmin = false;
  if (isAdmin) {
    const other = await db.query.memberships.findFirst({
      columns: { id: true },
      where: and(
        eq(memberships.circleId, circle.id),
        eq(memberships.role, "admin"),
        ne(memberships.userId, userId),
      ),
    });
    isLastAdmin = !other;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <CircleSwitcher
          currentSlug={circle.slug}
          circles={userCircles}
          size="sm"
        />
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

      <div className="flex flex-col gap-1 px-4 pt-6 sm:px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          You
        </span>
        <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
          {me.displayName}
        </h1>
        <p className="text-sm text-ink-muted">
          {isAdmin ? "Admin" : "Member"} of{" "}
          <span className="text-ink">{circle.name}</span>
        </p>
      </div>

      <div className="flex flex-col gap-8 px-4 pt-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Profile
          </h2>
          <EditDisplayName initialName={me.displayName} />
          <div className="flex flex-col gap-1 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-ink-muted">
              Email
            </span>
            <span className="truncate text-sm text-ink">{me.email}</span>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Notifications
          </h2>
          <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-ink">Plan emails</span>
                <span className="text-xs text-ink-muted">
                  New plans, comments on plans you voted on, reminders
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-paper-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                On
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              Granular preferences are coming. For now, plan emails go out by
              default.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Account
          </h2>
          <YouSignOutButton />
          <LeaveCircleButton
            circleId={circle.id}
            circleName={circle.name}
            isLastAdmin={isLastAdmin}
          />
        </section>
      </div>

      <BottomTabs slug={circle.slug} />
    </main>
  );
}
