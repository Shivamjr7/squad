import { z } from "zod";

export const voteStatusSchema = z.enum(["in", "out", "maybe"]);
export type VoteStatus = z.infer<typeof voteStatusSchema>;

export const castVoteSchema = z.object({
  planId: z.string().uuid(),
  status: voteStatusSchema,
});
export type CastVoteInput = z.infer<typeof castVoteSchema>;

export const removeVoteSchema = z.object({
  planId: z.string().uuid(),
});
export type RemoveVoteInput = z.infer<typeof removeVoteSchema>;
