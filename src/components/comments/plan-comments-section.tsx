import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { comments } from "@/db/schema";
import { PlanComments } from "@/components/comments/plan-comments";
import type { Member } from "@/lib/realtime/use-circle-votes";
import type { PlanComment } from "@/lib/realtime/use-plan-comments";

// Async server component — fetches comments independently so the rest of
// the plan-detail page can stream first. Wrapped in <Suspense> at the call
// site with a skeleton fallback.
export async function PlanCommentsSection({
  planId,
  members,
  currentUser,
  canCompose,
}: {
  planId: string;
  members: Record<string, Member>;
  currentUser: { id: string; displayName: string; avatarUrl: string | null };
  canCompose: boolean;
}) {
  const commentRows = await db.query.comments.findMany({
    where: eq(comments.planId, planId),
    orderBy: asc(comments.createdAt),
    with: {
      user: { columns: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  const initialComments: PlanComment[] = commentRows.map((c) => ({
    id: c.id,
    authorId: c.userId,
    authorName: c.user?.displayName ?? "Member",
    authorAvatarUrl: c.user?.avatarUrl ?? null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));
  return (
    <PlanComments
      planId={planId}
      members={members}
      initialComments={initialComments}
      currentUser={currentUser}
      canCompose={canCompose}
    />
  );
}

export function PlanCommentsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-12 rounded-lg bg-paper-card/60" />
      <div className="h-12 rounded-lg bg-paper-card/40" />
    </div>
  );
}
