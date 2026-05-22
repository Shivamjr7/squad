import { z } from "zod";
import { safePlainText } from "@/lib/validation/text";

export const COMMENT_BODY_MAX = 500;

export const addCommentSchema = z.object({
  planId: z.string().uuid(),
  body: safePlainText({
    min: 1,
    max: COMMENT_BODY_MAX,
    multiline: true,
    invalidMessage: "Comment contains characters we can't store.",
  }),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const deleteCommentSchema = z.object({
  commentId: z.string().uuid(),
});
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;
