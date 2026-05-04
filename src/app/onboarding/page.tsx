import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { CircleChooser } from "@/components/onboarding/circle-chooser";
import { requireDisplayNameSet } from "@/lib/auth";

export default async function OnboardingPage() {
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
          {hasCircles ? "Add another circle" : "Welcome to Squad"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {hasCircles
            ? "Spin one up or join with an invite link."
            : "Plan a thing. Vote. Show up."}
        </p>
      </header>
      <CircleChooser />
    </main>
  );
}
