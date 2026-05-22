import { z } from "zod";
import { safePlainText } from "@/lib/validation/text";

export const displayNameSchema = safePlainText({ min: 2, max: 40 })
  .refine((s) => !s.includes("@"), "Skip the @ — your friends know your email");

export const setDisplayNameSchema = z.object({
  displayName: displayNameSchema,
});

export type SetDisplayNameInput = z.infer<typeof setDisplayNameSchema>;
