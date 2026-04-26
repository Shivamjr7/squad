import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    const recent = await db.query.memberships.findFirst({
      where: eq(memberships.userId, userId),
      orderBy: desc(memberships.joinedAt),
      with: { circle: { columns: { slug: true } } },
    });
    if (recent?.circle?.slug) {
      redirect(`/c/${recent.circle.slug}`);
    }
    redirect("/onboarding");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Squad</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        Plan a thing. Vote. Show up.
      </p>
      <div className="flex gap-3">
        <SignInButton mode="modal">
          <Button>Sign in</Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button variant="outline">Sign up</Button>
        </SignUpButton>
      </div>
    </main>
  );
}
