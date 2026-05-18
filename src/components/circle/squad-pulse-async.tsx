import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { votes } from "@/db/schema";
import { getCircleMemberActivity } from "@/lib/circles";
import {
  SquadPulse,
  SquadPulseInline,
  type PulseMember,
} from "@/components/circle/squad-pulse";
import type { VoteStatus } from "@/lib/validation/vote";

type SidebarMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

// Async server component that resolves the per-member activity aggregate
// inside a Suspense boundary. The two MAX() queries it triggers in
// getCircleMemberActivity used to block the home page's first paint; this
// wrapper lets the hero + featured card stream first and the pulse fill
// in after.
export async function SquadPulseAsync({
  circleId,
  members,
  nowMs,
  variant,
  // Optional — when the home page has a "featured" plan to surface, we
  // also surface each pulse member's current vote on it as a tiny corner
  // dot on the avatar. Snapshot-at-render (the pulse is already a
  // snapshot of "last activity"); doesn't update on realtime vote
  // changes, but the page revalidates often enough to stay fresh.
  featuredPlanId,
}: {
  circleId: string;
  members: SidebarMember[];
  nowMs: number;
  variant: "desktop" | "mobile";
  featuredPlanId?: string | null;
}) {
  const [lastActiveByUser, voteByUser] = await Promise.all([
    getCircleMemberActivity(circleId),
    featuredPlanId
      ? getVotesForPlan(featuredPlanId)
      : Promise.resolve<Record<string, VoteStatus>>({}),
  ]);
  const now = new Date(nowMs);
  const pulseMembers: PulseMember[] = members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    lastActiveAt: lastActiveByUser[m.userId]
      ? new Date(lastActiveByUser[m.userId])
      : null,
  }));

  if (variant === "desktop") {
    return (
      <SquadPulse
        members={pulseMembers}
        now={now}
        voteByUser={voteByUser}
      />
    );
  }
  return (
    <SquadPulseInline
      members={pulseMembers}
      now={now}
      voteByUser={voteByUser}
    />
  );
}

async function getVotesForPlan(
  planId: string,
): Promise<Record<string, VoteStatus>> {
  const rows = await db
    .select({ userId: votes.userId, status: votes.status })
    .from(votes)
    .where(eq(votes.planId, planId));
  const out: Record<string, VoteStatus> = {};
  for (const r of rows) out[r.userId] = r.status;
  return out;
}

// Tiny skeleton shown while SquadPulseAsync is in flight. Sized to match
// the rendered chip strip / sidebar card so layout doesn't shift.
export function SquadPulseSkeleton({
  variant,
}: {
  variant: "desktop" | "mobile";
}) {
  if (variant === "desktop") {
    return (
      <section
        aria-hidden
        className="rounded-3xl border border-ink/10 bg-paper-card p-4 shadow-sm"
      >
        <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
        <ul className="mt-3 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-ink/10" />
              <div className="flex flex-1 flex-col gap-1">
                <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
                <div className="h-3 w-12 animate-pulse rounded bg-ink/10" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div
      aria-hidden
      className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0"
    >
      <span className="h-3 w-10 shrink-0 animate-pulse rounded bg-ink/10" />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-ink/10"
        />
      ))}
    </div>
  );
}
