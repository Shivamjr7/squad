import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "At least 2 characters")
  .max(40, "40 characters max")
  .refine((s) => !s.includes("@"), "Skip the @ — your friends know your email");

export const setDisplayNameSchema = z.object({
  displayName: displayNameSchema,
});

export type SetDisplayNameInput = z.infer<typeof setDisplayNameSchema>;
