import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { invites, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { InviteButton } from "@/components/circle/invite-button";
import { LeaveCircleButton } from "@/components/circle/leave-circle-button";
import { MembersList, type ListMember } from "@/components/circle/members-list";
import {
  getCircleBySlug,
  getCircleMembers,
  getKnownSquadUsers,
  type CircleMemberRow,
} from "@/lib/circles";
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

  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  // memberRows cache-hit from shell layout; only `invites` runs. userCircles
  // is no longer needed here — the duplicate page-header CircleSwitcher was
  // removed in favor of the AppShell mobile top bar (and desktop sidebar).
  const [memberRows, activeInvites] = await Promise.all([
    getCircleMembers(circle.id) as Promise<CircleMemberRow[]>,
    db.query.invites.findMany({
      columns: { code: true },
      where: eq(invites.circleId, circle.id),
      orderBy: desc(invites.createdAt),
    }),
  ]);

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();
  const isAdmin = me.role === "admin";

  const knownUsers = isAdmin
    ? await getKnownSquadUsers(userId, circle.id)
    : [];

  // Last-admin check: if I'm an admin and there are no other admins, leaving
  // would orphan the circle. Block it on the client + server. Lifted from
  // /you to /squad along with the LeaveCircleButton itself.
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

  const members: ListMember[] = memberRows
    .filter((m) => m.user)
    .map((m) => ({
      userId: m.user!.id,
      displayName: m.user!.displayName,
      avatarUrl: m.user!.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt
        ? typeof m.joinedAt === "string"
          ? m.joinedAt
          : m.joinedAt.toISOString()
        : new Date().toISOString(),
    }));

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      {/* Desktop-only top row — mirrors the home page pattern. Mobile uses
          the AppShell top bar (SquadLogo + CircleSwitcher + search/bell/
          theme) so the per-page header would just duplicate the switcher. */}
      <div className="hidden items-center justify-end gap-1 px-6 pt-3 md:flex">
        {isAdmin ? (
          <Button asChild variant="ghost" size="icon" aria-label="Settings">
            <Link href={`/c/${circle.slug}/settings`}>
              <Settings />
            </Link>
          </Button>
        ) : null}
        <UserButton />
      </div>

      <div className="px-4 pt-6 sm:px-6">
        <div className="space-y-6">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-ink-muted">
              Squad
            </span>
            <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
              {circle.name}
            </h1>
            <p className="text-sm text-ink-muted">
              {members.length} {members.length === 1 ? "person" : "people"}
            </p>
          </div>

          <div className="px-0 sm:px-0">
            <InviteButton
              circleId={circle.id}
              isAdmin={isAdmin}
              activeInvites={activeInvites}
              knownUsers={knownUsers}
              variant="row"
            />
          </div>

          <section className="flex flex-col gap-1 px-0 sm:px-0">
            <MembersList
              circleId={circle.id}
              members={members}
              currentUserId={userId}
              isAdmin={isAdmin}
            />
          </section>

          {/* Leave-circle moved from /you so the You tab can stay circle-
              agnostic. Lives at the bottom of the Squad page, next to the
              member list — the natural place for a per-circle exit. */}
          <section className="flex flex-col gap-2 border-t border-ink-hairline pt-6 md:max-w-md">
            <LeaveCircleButton
              circleId={circle.id}
              circleName={circle.name}
              isLastAdmin={isLastAdmin}
            />
          </section>
        </div>
      </div>

    </main>
  );
}
