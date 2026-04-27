import { z } from "zod";

export const COMMENT_BODY_MAX = 500;

export const addCommentSchema = z.object({
  planId: z.string().uuid(),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, "Say something first.")
        .max(COMMENT_BODY_MAX, `Keep it under ${COMMENT_BODY_MAX} characters.`),
    ),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;
