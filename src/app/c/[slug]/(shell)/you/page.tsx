import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, pushSubscriptions, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { EditDisplayName } from "@/components/circle/edit-display-name";
import { LeaveCircleButton } from "@/components/circle/leave-circle-button";
import { YouSignOutButton } from "@/components/circle/sign-out-button";
import {
  ManageDevices,
  type ManageDeviceRow,
} from "@/components/circle/manage-devices";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getCircleBySlug, getUserCircles } from "@/lib/circles";
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

  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  const [me, membership, userCircles, pushRows] = await Promise.all([
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
    db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        deviceHint: pushSubscriptions.deviceHint,
        lastUsedAt: pushSubscriptions.lastUsedAt,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId)),
  ]);
  if (!me || !membership) notFound();
  const devices: ManageDeviceRow[] = pushRows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    deviceHint:
      r.deviceHint === "mobile" || r.deviceHint === "desktop"
        ? r.deviceHint
        : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

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
              You
            </span>
            <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
              {me.displayName}
            </h1>
            <p className="text-sm text-ink-muted">
              {isAdmin ? "Admin" : "Member"} of <span className="text-ink">{circle.name}</span>
            </p>
          </div>

          {/* Two-column on ≥md: Profile on the left, Preferences + Devices
              on the right. Account section spans the full width below since
              it's destructive-adjacent and deserves its own visual zone. */}
          <div className="grid grid-cols-1 gap-8 px-0 sm:px-0 md:grid-cols-2 md:gap-x-10">
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow text-ink-muted">
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

            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h2 className="eyebrow text-ink-muted">
                  Preferences
                </h2>
                <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
                  <span className="text-xs uppercase tracking-wide text-ink-muted">
                    Theme
                  </span>
                  <ThemeToggle variant="segment" />
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="eyebrow text-ink-muted">
                  Manage devices
                </h2>
                <p className="text-xs text-ink-muted">
                  Squad pings you when a new plan drops, when one&apos;s about
                  to lock, and 45 minutes before you should leave. One row per
                  device you&apos;ve enabled.
                </p>
                <ManageDevices devices={devices} />
              </section>
            </div>

            <section className="flex flex-col gap-3 md:col-span-2 md:border-t md:border-ink-hairline md:pt-6">
              <h2 className="eyebrow text-ink-muted">
                Account
              </h2>
              <div className="flex flex-col gap-3 md:max-w-md">
                <YouSignOutButton />
                <LeaveCircleButton
                  circleId={circle.id}
                  circleName={circle.name}
                  isLastAdmin={isLastAdmin}
                />
              </div>
            </section>
          </div>
        </div>
      </div>

    </main>
  );
}
