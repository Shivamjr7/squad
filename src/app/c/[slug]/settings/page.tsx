import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, invites, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { RenameCircleForm } from "@/components/settings/rename-circle-form";
import { GenerateInviteForm } from "@/components/settings/generate-invite-form";

export default async function SettingsPage({
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
  if (!membership) notFound();
  if (membership.role !== "admin") redirect(`/c/${circle.slug}`);

  const [activeInvites, memberRows] = await Promise.all([
    db.query.invites.findMany({
      columns: { id: true, code: true, uses: true, createdAt: true },
      where: eq(invites.circleId, circle.id),
      orderBy: desc(invites.createdAt),
    }),
    db.query.memberships.findMany({
      columns: { id: true, role: true, joinedAt: true },
      where: eq(memberships.circleId, circle.id),
      orderBy: desc(memberships.joinedAt),
      with: {
        user: { columns: { displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/c/${circle.slug}`}>
            <ArrowLeft /> Back
          </Link>
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <span className="w-12" aria-hidden />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Circle name</h2>
        <RenameCircleForm circleId={circle.id} initialName={circle.name} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Invite links</h2>
        <GenerateInviteForm circleId={circle.id} />
        {activeInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invites yet. Generate one to share via WhatsApp.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <code className="truncate font-mono text-xs">{inv.code}</code>
                <span className="shrink-0 text-xs text-muted-foreground">
                  used {inv.uses}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Members ({memberRows.length})
        </h2>
        {memberRows.length === 1 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Just you so far. Generate an invite to bring the squad in.
          </p>
        ) : (
        <ul className="flex flex-col gap-2">
          {memberRows.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              {m.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.user.avatarUrl}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                  {m.user.displayName.slice(0, 1)}
                </div>
              )}
              <span className="flex-1 truncate text-sm">{m.user.displayName}</span>
              <span className="shrink-0 text-xs text-muted-foreground capitalize">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
        )}
      </section>
    </main>
  );
}
