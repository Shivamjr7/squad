import { z } from "zod";

export const planTypeSchema = z.enum([
  "eat",
  "play",
  "chai",
  "stay-in",
  "other",
]);

export type PlanType = z.infer<typeof planTypeSchema>;

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
  startsAtLocal: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Pick a valid date and time.",
    ),
  timeZone: z.string().min(1, "Missing time zone."),
  isApproximate: z.boolean(),
  location: z
    .string()
    .trim()
    .max(100, "Location must be 100 characters or fewer")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
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
