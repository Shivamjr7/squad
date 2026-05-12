import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invites } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { InviteButton } from "@/components/circle/invite-button";
import { MembersList, type ListMember } from "@/components/circle/members-list";
import {
  getCircleBySlug,
  getCircleMembers,
  getKnownSquadUsers,
  getUserCircles,
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

  // memberRows + userCircles cache-hit from shell layout; only `invites` runs.
  const [memberRows, activeInvites, userCircles] = await Promise.all([
    getCircleMembers(circle.id),
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
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
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
        </div>
      </div>

    </main>
  );
}
