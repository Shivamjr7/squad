import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
import { CircleChooser } from "@/components/onboarding/circle-chooser";

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  // Hard redirect: if the user already belongs to any circle, send them
  // straight to the most-recently joined one. (Multi-circle UX is v2 per
  // PLAN.md §13 — onboarding is for first-time-only.)
  const recent = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
    orderBy: desc(memberships.joinedAt),
    with: { circle: { columns: { slug: true } } },
  });
  if (recent?.circle?.slug) {
    redirect(`/c/${recent.circle.slug}`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 p-6 pt-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Squad</h1>
        <p className="text-sm text-muted-foreground">
          Plan a thing. Vote. Show up.
        </p>
      </header>
      <CircleChooser />
    </main>
  );
}
