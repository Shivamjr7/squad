import { z } from "zod";
import { safePlainText } from "@/lib/validation/text";

export const castVenueVoteSchema = z.object({
  planId: z.string().uuid(),
  venueId: z.string().uuid(),
});
export type CastVenueVoteInput = z.infer<typeof castVenueVoteSchema>;

export const addVenueSchema = z.object({
  planId: z.string().uuid(),
  label: safePlainText({ min: 1, max: 100 }),
});
export type AddVenueInput = z.infer<typeof addVenueSchema>;
