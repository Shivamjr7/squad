import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { and, eq, or, isNull, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invites, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireDisplayNameSet } from "@/lib/auth";
import { CIRCLE_TAGS } from "@/lib/circles";

function InvalidInvitePage({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">
        This invite isn&apos;t valid anymore.
      </h1>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <p className="text-sm text-muted-foreground">
        Ask whoever sent it for a new one.
      </p>
      <Button asChild variant="outline" className="mt-2">
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

  // Friendly early-exit when the invite is obviously dead. The atomic
  // UPDATE below re-checks both predicates server-side, so this is just
  // UX — the actual gate is the conditional UPDATE.
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
  await requireDisplayNameSet(userId);

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

  // Atomic redemption: one conditional UPDATE re-checks expiry + max_uses
  // under a row lock. If two requests race, only one increments — the
  // loser sees `claimed` empty and falls through to InvalidInvitePage.
  // This closes the window where the pre-checks above pass for both
  // concurrent joiners on a maxUses=1 invite.
  const claimed = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(
      and(
        eq(invites.id, invite.id),
        or(isNull(invites.maxUses), sql`${invites.uses} < ${invites.maxUses}`),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`NOW()`)),
      ),
    )
    .returning({ id: invites.id });

  if (claimed.length === 0) {
    return (
      <InvalidInvitePage reason="This invite was just used up. Ask whoever sent it for a fresh link." />
    );
  }

  // Membership insert is idempotent against the (user_id, circle_id)
  // unique constraint, so safe outside the transaction. If two retries
  // race here, the second hits ON CONFLICT and we just continue.
  await db
    .insert(memberships)
    .values({ userId, circleId: invite.circleId, role: "member" })
    .onConflictDoNothing();

  // Drop cached member + user-circles + activity entries so the home page
  // and squad sidebar show the new member immediately. `after()` defers
  // these to after the response is sent — Next.js 15 forbids calling
  // `revalidateTag` during render, which is what tripped the invite-join
  // flow with "revalidateTag user-circles during render is unsupported".
  after(() => {
    revalidateTag(CIRCLE_TAGS.userCircles);
    revalidateTag(CIRCLE_TAGS.circleMembers);
    revalidateTag(CIRCLE_TAGS.circleActivity);
  });

  redirect(`/c/${invite.circle.slug}?joined=new`);
}
