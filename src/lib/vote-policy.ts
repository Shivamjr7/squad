import type { VoteStatus } from "@/lib/validation/vote";

export type PlanVotePolicyStatus = "active" | "confirmed" | "done" | "cancelled";

export function canCastPlanVote(input: {
  planStatus: PlanVotePolicyStatus;
  previousVote: VoteStatus | null;
  nextVote: VoteStatus;
  isLapsed?: boolean;
}): boolean {
  const { planStatus, nextVote, isLapsed = false } = input;
  if (isLapsed) return false;
  if (planStatus === "active") return true;
  if (planStatus === "confirmed") return nextVote === "out";
  return false;
}

export function removeVoteMode(
  planStatus: PlanVotePolicyStatus,
  isLapsed = false,
): "delete" | "mark-out" | "blocked" {
  if (isLapsed) return "blocked";
  if (planStatus === "active") return "delete";
  if (planStatus === "confirmed") return "mark-out";
  return "blocked";
}

export function isPlanLapsed(input: {
  planStatus: PlanVotePolicyStatus;
  decideBy: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return (
    input.planStatus === "active" &&
    input.decideBy !== null &&
    input.decideBy.getTime() <= now.getTime()
  );
}

export function canAutoLockFromInCount({
  inCount,
  lockThreshold,
}: {
  inCount: number;
  lockThreshold: number;
}): boolean {
  return inCount >= lockThreshold;
}
