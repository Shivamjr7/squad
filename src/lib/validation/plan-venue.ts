import { z } from "zod";

export const castVenueVoteSchema = z.object({
  planId: z.string().uuid(),
  venueId: z.string().uuid(),
});
export type CastVenueVoteInput = z.infer<typeof castVenueVoteSchema>;

export const addVenueSchema = z.object({
  planId: z.string().uuid(),
  label: z
    .string()
    .trim()
    .min(1, "Venue name can't be empty")
    .max(100, "Venue must be 100 characters or fewer"),
});
export type AddVenueInput = z.infer<typeof addVenueSchema>;
