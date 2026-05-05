import { z } from "zod";

export const planTypeSchema = z.enum([
  "eat",
  "play",
  "chai",
  "stay-in",
  "other",
]);

export type PlanType = z.infer<typeof planTypeSchema>;

export const planTimeModeSchema = z.enum(["exact", "open"]);
export type PlanTimeMode = z.infer<typeof planTimeModeSchema>;

// Submitted by the new-plan form. The wall-clock + timezone pair lets the
// server reconstruct the correct UTC moment regardless of where Vercel runs.
// See src/lib/tz.ts for the conversion.
export const createPlanSchema = z.object({
  circleId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title must be 100 characters or fewer"),
  type: planTypeSchema,
  timeMode: planTimeModeSchema.optional().default("exact"),
  startsAtLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid date and time.",
    ),
  timeZone: z.string().min(1, "Missing time zone."),
  isApproximate: z.boolean(),
  decideByLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid deadline.",
    )
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  location: z
    .string()
    .trim()
    .max(100, "Location must be 100 characters or fewer")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  // Optional extra venue suggestions from the create-plan form. The first
  // input is `location`; anything here becomes additional `plan_venues` rows.
  // Empty / whitespace-only entries are dropped server-side.
  extraVenues: z
    .array(z.string().trim().max(100, "Venue must be 100 characters or fewer"))
    .max(8, "Up to 8 venue options")
    .optional()
    .transform((arr) => (arr ? arr.filter((s) => s.length > 0) : [])),
  maxPeople: z
    .number()
    .int()
    .positive("Must be at least 1")
    .max(1000, "That's a lot of people.")
    .nullable()
    .optional()
    .transform((v) => (v ?? null)),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const planIdSchema = z.object({
  planId: z.string().uuid(),
});
export type PlanIdInput = z.infer<typeof planIdSchema>;
