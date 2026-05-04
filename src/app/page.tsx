import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { getMostRecentCircleSlug, requireDisplayNameSet } from "@/lib/auth";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    await requireDisplayNameSet(userId);
    const slug = await getMostRecentCircleSlug(userId);
    if (slug) {
      redirect(`/c/${slug}`);
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
