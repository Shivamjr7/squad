import { z } from "zod";

export const proposeTimeSchema = z.object({
  planId: z.string().uuid(),
  startsAtLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid date and time.",
    ),
  timeZone: z.string().min(1, "Missing time zone."),
});
export type ProposeTimeInput = z.infer<typeof proposeTimeSchema>;

export const castProposalVoteSchema = z.object({
  planId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
export type CastProposalVoteInput = z.infer<typeof castProposalVoteSchema>;
