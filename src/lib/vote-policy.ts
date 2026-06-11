import type { VoteStatus } from "@/lib/validation/vote";

export type PlanVotePolicyStatus = "active" | "confirmed" | "done" | "cancelled";

export function canCastPlanVote(input: {
  planStatus: PlanVotePolicyStatus;
  previousVote: VoteStatus | null;
  nextVote: VoteStatus;
}): boolean {
  const { planStatus, nextVote } = input;
  if (planStatus === "active") return true;
  if (planStatus === "confirmed") return nextVote === "out";
  return false;
}

export function removeVoteMode(planStatus: PlanVotePolicyStatus): "delete" | "mark-out" | "blocked" {
  if (planStatus === "active") return "delete";
  if (planStatus === "confirmed") return "mark-out";
  return "blocked";
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
