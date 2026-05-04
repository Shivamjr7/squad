import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { SetNameForm } from "@/components/onboarding/set-name-form";

export default async function SetNamePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const me = await db.query.users.findFirst({
    columns: { displayName: true, email: true, hasSetDisplayName: true },
    where: eq(users.id, userId),
  });
  if (me?.hasSetDisplayName) redirect("/");

  // Pre-fill: if the current name looks like an email, use the prefix.
  const initial = me?.displayName ?? "";
  const prefilled = initial.includes("@")
    ? (initial.split("@")[0] ?? "")
    : initial;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-ink">
          What should your friends call you?
        </h1>
        <p className="text-sm text-muted-foreground">
          This is what shows up on your votes and comments.
        </p>
      </div>
      <SetNameForm initialName={prefilled} />
    </main>
  );
}
