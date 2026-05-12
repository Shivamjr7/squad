import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { NotificationsFeed } from "@/components/notifications/notifications-feed";
import { getCircleBySlug, getUserCircles } from "@/lib/circles";
import { listNotifications } from "@/lib/actions/notifications";
import { requireDisplayNameSet } from "@/lib/auth";

export default async function NotificationsPage({
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

  const [rows, userCircles] = await Promise.all([
    listNotifications(),
    getUserCircles(userId),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <CircleSwitcher
          currentSlug={circle.slug}
          circles={userCircles}
          size="sm"
        />
      </header>

      <div className="px-4 pt-6 sm:px-6">
        <div className="space-y-6">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-ink-muted">
              Inbox
            </span>
            <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
              Notifications
            </h1>
            <p className="text-sm text-ink-muted">
              Plans, votes, and reminders for everything you&rsquo;re in on.
            </p>
          </div>

          <NotificationsFeed initialRows={rows} />
        </div>
      </div>
    </main>
  );
}
