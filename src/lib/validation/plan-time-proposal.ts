import { z } from "zod";

export const proposalKindSchema = z.enum(["replacement", "addition"]);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

export const proposeTimeSchema = z.object({
  planId: z.string().uuid(),
  startsAtLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid date and time.",
    ),
  timeZone: z.string().min(1, "Missing time zone."),
  // M24 — `addition` is a stacked sub-plan (PLUS row on the live ticker /
  // AFTER row on the receipt), NOT a vote-candidate for the same slot. The
  // existing M22 form keeps sending the default `replacement`.
  kind: proposalKindSchema.optional().default("replacement"),
  // For `addition` rows we capture a label ("Bar Tartine", "Karan's place")
  // so the PLUS/AFTER row can show what the add-on is. Optional for back-
  // compat with M22 callers that only send a time.
  label: z
    .string()
    .trim()
    .max(100, "Keep it under 100 characters")
    .optional(),
});
export type ProposeTimeInput = z.infer<typeof proposeTimeSchema>;

export const castProposalVoteSchema = z.object({
  planId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
export type CastProposalVoteInput = z.infer<typeof castProposalVoteSchema>;
