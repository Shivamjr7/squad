import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, invites, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { InviteButton } from "@/components/circle/invite-button";
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { MembersList, type ListMember } from "@/components/circle/members-list";
import { getKnownSquadUsers, getUserCircles } from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";

export default async function SquadPage({
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

  const [memberRows, activeInvites, userCircles] = await Promise.all([
    db.query.memberships.findMany({
      where: eq(memberships.circleId, circle.id),
      orderBy: asc(memberships.joinedAt),
      with: {
        user: {
          columns: { id: true, displayName: true, avatarUrl: true },
        },
      },
    }),
    db.query.invites.findMany({
      columns: { code: true },
      where: eq(invites.circleId, circle.id),
      orderBy: desc(invites.createdAt),
    }),
    getUserCircles(userId),
  ]);

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();
  const isAdmin = me.role === "admin";

  const knownUsers = isAdmin
    ? await getKnownSquadUsers(userId, circle.id)
    : [];

  const members: ListMember[] = memberRows
    .filter((m) => m.user)
    .map((m) => ({
      userId: m.user!.id,
      displayName: m.user!.displayName,
      avatarUrl: m.user!.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));

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
          Squad
        </span>
        <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
          {circle.name}
        </h1>
        <p className="text-sm text-ink-muted">
          {members.length} {members.length === 1 ? "person" : "people"}
        </p>
      </div>

      <div className="px-4 pt-5 sm:px-6">
        <InviteButton
          circleId={circle.id}
          isAdmin={isAdmin}
          activeInvites={activeInvites}
          knownUsers={knownUsers}
          variant="row"
        />
      </div>

      <section className="flex flex-col gap-1 px-3 pt-4 sm:px-5">
        <MembersList
          circleId={circle.id}
          members={members}
          currentUserId={userId}
          isAdmin={isAdmin}
        />
      </section>

      <BottomTabs slug={circle.slug} />
    </main>
  );
}
