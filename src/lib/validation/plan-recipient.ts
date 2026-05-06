import { z } from "zod";

// M23 — adding members to a plan's recipient set mid-flight (creator/admin
// from the plan-detail Squad section). Empty arrays are rejected at the
// action layer because there's no use-case for "add zero people".
export const addPlanRecipientsSchema = z.object({
  planId: z.string().uuid(),
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

export type AddPlanRecipientsInput = z.infer<typeof addPlanRecipientsSchema>;
