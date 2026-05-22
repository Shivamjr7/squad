import { z } from "zod";
import { isReservedSlug, slugRegex } from "@/lib/slug";
import { safePlainText } from "@/lib/validation/text";

export const circleNameSchema = safePlainText({ min: 3, max: 40 });

export const circleSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "URL must be at least 3 characters")
  .max(40, "URL must be 40 characters or fewer")
  .regex(slugRegex, "Use lowercase letters, numbers, and single hyphens")
  .refine((s) => !isReservedSlug(s), "That URL is reserved — try another");

export const createCircleSchema = z.object({
  name: circleNameSchema,
  slug: circleSlugSchema,
});

export const renameCircleSchema = z.object({
  name: circleNameSchema,
});

export type CreateCircleInput = z.infer<typeof createCircleSchema>;
export type RenameCircleInput = z.infer<typeof renameCircleSchema>;
