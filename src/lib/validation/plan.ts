import { z } from "zod";
import { safePlainText } from "@/lib/validation/text";

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
  title: safePlainText({ min: 3, max: 100 }),
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
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) =>
        v === null ||
        safePlainText({ max: 100 }).safeParse(v).success,
      "Location must be 100 characters or fewer and use plain text.",
    )
    .transform((v) =>
      v === null
        ? null
        : safePlainText({ max: 100 }).parse(v),
    ),
  // Optional extra venue suggestions from the create-plan form. The first
  // input is `location`; anything here becomes additional `plan_venues` rows.
  // Empty / whitespace-only entries are dropped server-side.
  extraVenues: z
    .array(z.string())
    .max(8, "Up to 8 venue options")
    .optional()
    .transform((arr) =>
      (arr ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => safePlainText({ max: 100 }).parse(s)),
    ),
  maxPeople: z
    .number()
    .int()
    .positive("Must be at least 1")
    .max(1000, "That's a lot of people.")
    .nullable()
    .optional()
    .transform((v) => (v ?? null)),
  // M23 — explicit recipient set. Empty array = full circle (back-compat
  // path; the chip picker writes [] when "ALL" is selected). When non-empty,
  // the server will additionally enforce that every id is a circle member
  // and that the creator is included.
  recipientUserIds: z
    .array(z.string().min(1))
    .max(200, "Too many recipients")
    .optional()
    .default([]),
  // Suggest Plan — venue provenance for rows picked from the Suggest
  // drawer. Each entry becomes a `plan_venues` row with
  // `source='suggestion'` and `suggestion_item_id` set; createPlan also
  // patches `suggestion_logs.planId` so the receipt timeline + lifecycle
  // hooks (auto-lock 'won', cancelPlan 'cancelled') fire. Optional and
  // defaults to []; existing call sites (FAB / header trigger) never set
  // this and keep their plain-string venue flow.
  suggestions: z
    .array(
      z.object({
        label: safePlainText({ min: 1, max: 100 }),
        suggestionLogId: z.string().uuid(),
        itemId: z.string().uuid(),
      }),
    )
    .max(8, "Up to 8 suggestion venues")
    .optional()
    .default([]),
  // Creator's chosen auto-lock threshold (PLAN.md §6 amendment, M22 column).
  // Optional — the server clamps to min(value, eligibleVoters) and defaults
  // to min(5, eligibleVoters) when omitted. 200 ceiling matches recipients.
  lockThreshold: z
    .number()
    .int()
    .min(1, "Lock threshold must be at least 1")
    .max(200, "Lock threshold too large")
    .optional(),
  // UI Phase 7 — optional one-word "vibe" the creator can attach. Presets
  // surfaced in the form (Chill / Hype / Quick / Cosy / Late) but the
  // schema accepts any short string. Empty / whitespace coerced to null.
  vibe: z
    .string()
    .trim()
    .max(12, "Keep it short — 12 characters or fewer.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const planIdSchema = z.object({
  planId: z.string().uuid(),
});
export type PlanIdInput = z.infer<typeof planIdSchema>;
