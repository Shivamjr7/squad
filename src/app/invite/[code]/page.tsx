import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invites, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";

function InvalidInvitePage({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">This invite isn&apos;t valid</h1>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <Button asChild variant="outline">
        <Link href="/">Back home</Link>
      </Button>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const invite = await db.query.invites.findFirst({
    columns: {
      id: true,
      circleId: true,
      expiresAt: true,
      maxUses: true,
      uses: true,
    },
    where: eq(invites.code, code),
    with: { circle: { columns: { slug: true } } },
  });

  if (!invite || !invite.circle) {
    return <InvalidInvitePage reason="The link may have been mistyped or revoked." />;
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return <InvalidInvitePage reason="This invite has expired." />;
  }

  if (invite.maxUses != null && invite.uses >= invite.maxUses) {
    return <InvalidInvitePage reason="This invite has been used the maximum number of times." />;
  }

  const { userId } = await auth();
  if (!userId) {
    // Bounce through sign-in and come back here. Clerk's <SignIn /> honors
    // ?redirect_url= as a fallback redirect after successful auth.
    const target = `/invite/${encodeURIComponent(code)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
  }

  // Idempotent: if already a member, just bounce them in (no uses++).
  const existing = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.circleId, invite.circleId),
    ),
  });
  if (existing) {
    redirect(`/c/${invite.circle.slug}?joined=existing`);
  }

  // Insert membership and bump uses atomically.
  await db.transaction(async (tx) => {
    await tx.insert(memberships).values({
      userId,
      circleId: invite.circleId,
      role: "member",
    });
    await tx
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(eq(invites.id, invite.id));
  });

  redirect(`/c/${invite.circle.slug}?joined=new`);
}
