import { z } from "zod";

// Mirrors the JSON returned by `PushSubscription.toJSON()` in the browser.
// Validation is defensive — the server treats this blob as opaque and only
// uses it when fan-out fires (M27).
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  expirationTime: z.number().int().nullable(),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
