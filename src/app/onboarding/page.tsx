import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleChooser } from "@/components/onboarding/circle-chooser";
import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { requireDisplayNameSet } from "@/lib/auth";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  await requireDisplayNameSet(userId);

  // Reachable both for first-time users (no memberships) and existing users
  // adding another circle. Copy adjusts based on whether they already belong
  // to anything. Post-signin redirect on `/` still sends users to their most
  // recent circle — only this page is always-reachable.
  const existing = await db.query.memberships.findFirst({
    columns: { id: true },
    where: eq(memberships.userId, userId),
    with: { circle: { columns: { slug: true } } },
  });
  const hasCircles = Boolean(existing);
  const backSlug = existing?.circle?.slug ?? null;

  // `?mode=create` (from the home Circles tab "+" tile) skips the chooser
  // step and renders CreateCircleForm directly. `?mode=join` is honoured
  // symmetrically for invite deep-links. First-time visitors still land on
  // the chooser by default.
  const sp = await searchParams;
  const initialMode =
    sp.mode === "create" || sp.mode === "join" ? sp.mode : "chooser";

  // First-time users land on a 3-step checklist (Create/join → Invite →
  // First plan) so the whole arc is legible from the first screen. The
  // older single-purpose chooser is preserved for existing members who
  // reach this route to add another circle.
  if (!hasCircles) {
    const userRow = await db.query.users.findFirst({
      columns: { displayName: true },
      where: eq(users.id, userId),
    });
    const firstName =
      userRow?.displayName?.trim().split(/\s+/)[0] ?? "there";
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 p-6 pt-12">
        <FirstRunChecklist firstName={firstName} initialMode={initialMode} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 p-6 pt-12">
      {backSlug ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
        >
          <Link href={`/c/${backSlug}`}>
            <ArrowLeft /> Back
          </Link>
        </Button>
      ) : null}
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Add another circle
        </h1>
        <p className="text-sm text-muted-foreground">
          Spin one up or join with an invite link.
        </p>
      </header>
      <CircleChooser initialMode={initialMode} />
    </main>
  );
}
