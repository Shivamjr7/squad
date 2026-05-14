// Suggest Plan — zod schemas for the API boundary. See
// docs/specs/suggest-plan/05-api-contracts.md.
//
// Two surfaces:
//   - getSuggestionsSchema  → server action input
//   - recordFeedbackSchema  → server action input (client-writable feedback only;
//     `won` / `cancelled` are server-internal, see auto-lock.ts in S7).

import { z } from "zod";
import {
  ACTIVITY_CATEGORIES,
  BUDGET_TIERS,
} from "@/lib/suggest/types";
import { planTimeModeSchema, planTypeSchema } from "@/lib/validation/plan";

export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategoryInput = z.infer<typeof activityCategorySchema>;

export const budgetTierSchema = z.enum(BUDGET_TIERS);
export type BudgetTierInput = z.infer<typeof budgetTierSchema>;

export const clientFeedbackSchema = z.enum(["add", "reject", "refresh"]);
export type ClientFeedback = z.infer<typeof clientFeedbackSchema>;

export const getSuggestionsSchema = z.object({
  circleId: z.string().uuid(),
  planType: planTypeSchema,
  timeMode: planTimeModeSchema,
  startsAtLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid date and time.",
    ),
  timeZone: z.string().min(1, "Missing time zone."),
  isApproximate: z.boolean(),
  geo: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyMeters: z.number().nonnegative().optional(),
    })
    .optional(),
  distanceKmCap: z.number().min(0.5).max(100).optional(),
  budgetTier: budgetTierSchema.optional(),
  excludeIds: z.array(z.string()).max(50).default([]),
  recipientUserIds: z.array(z.string().min(1)).max(200).default([]),
  limit: z.number().int().min(1).max(10).default(5),
  requestNonce: z.string().uuid(),
});
export type GetSuggestionsInput = z.infer<typeof getSuggestionsSchema>;

export const recordFeedbackSchema = z.object({
  suggestionLogId: z.string().uuid(),
  itemId: z.string().uuid(),
  feedback: clientFeedbackSchema,
});
export type RecordFeedbackInput = z.infer<typeof recordFeedbackSchema>;
