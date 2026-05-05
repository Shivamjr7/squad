import { z } from "zod";

export const toggleSlotVoteSchema = z.object({
  planId: z.string().uuid(),
  slotId: z.string().uuid(),
});

export type ToggleSlotVoteInput = z.infer<typeof toggleSlotVoteSchema>;
