import { z } from "zod";
import { isReservedSlug, slugRegex } from "@/lib/slug";

export const circleNameSchema = z
  .string()
  .trim()
  .min(3, "Name must be at least 3 characters")
  .max(40, "Name must be 40 characters or fewer");

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
