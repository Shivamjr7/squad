import { z } from "zod";

// Mirrors the JSON returned by `PushSubscription.toJSON()` in the browser.
// Server translates this into a row in `push_subscriptions` keyed by
// endpoint. The blob is otherwise opaque — keys.p256dh + keys.auth feed the
// AES-128-GCM payload encryption that the push service relays.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  expirationTime: z.number().int().nullable(),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// M30 — passed by the client when subscribing so the server can label which
// device this row belongs to in the You page list.
export const deviceHintSchema = z
  .union([z.literal("mobile"), z.literal("desktop")])
  .nullable()
  .optional();

export const subscribePushSchema = z.object({
  subscription: pushSubscriptionSchema,
  deviceHint: deviceHintSchema,
});

export type SubscribePushInput = z.infer<typeof subscribePushSchema>;

export const unsubscribePushSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export type UnsubscribePushInput = z.infer<typeof unsubscribePushSchema>;
