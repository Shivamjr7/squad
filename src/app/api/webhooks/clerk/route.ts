import { headers } from "next/headers";
import { revalidateTag } from "next/cache";
import { Webhook } from "svix";
import { db } from "@/db/client";
import { users, webhookEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizeAvatarUrl } from "@/lib/avatar";
import { USER_DISPLAY_NAME_TAG } from "@/lib/auth";
import { USER_PROFILE_TAG } from "@/lib/server-cache";
import { safePlainText } from "@/lib/validation/text";

// Clerk webhook payload shapes. Only the fields we touch are typed.
type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkUserData = {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  image_url: string | null;
};

type ClerkDeletedData = {
  id: string;
  deleted?: boolean;
};

type ClerkEvent =
  | { type: "user.created"; data: ClerkUserData }
  | { type: "user.updated"; data: ClerkUserData }
  | { type: "user.deleted"; data: ClerkDeletedData }
  | { type: string; data: unknown };

function pickPrimaryEmail(data: ClerkUserData): string | null {
  const primary =
    data.email_addresses.find((e) => e.id === data.primary_email_address_id) ??
    data.email_addresses[0];
  return primary?.email_address ?? null;
}

type DerivedName = { displayName: string; isReal: boolean };

// "Real" = came from Google's profile (first/last name) or a chosen username.
// Email-prefix and the raw email are fallbacks — we treat them as not real
// so the user is prompted to set a name they actually want their friends to see.
function deriveDisplayName(data: ClerkUserData, email: string): DerivedName {
  const full = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  // Run the candidate through the same safePlainText sanitization as
  // user-entered names. If Clerk hands us a name with control chars or
  // zero-width quirks (third-party SSO can produce these), we fall
  // through to the next candidate rather than persist garbage.
  const sanitize = safePlainText({ max: 40 });
  if (full) {
    const ok = sanitize.safeParse(full);
    if (ok.success) return { displayName: ok.data, isReal: true };
  }
  if (data.username) {
    const ok = sanitize.safeParse(data.username);
    if (ok.success) return { displayName: ok.data, isReal: true };
  }
  const prefix = email.split("@")[0];
  if (prefix) {
    const ok = sanitize.safeParse(prefix);
    if (ok.success) return { displayName: ok.data, isReal: false };
  }
  // Last resort: a guaranteed-safe placeholder. Users hit /set-name on
  // first signed-in render and pick a real one.
  return { displayName: "Member", isReal: false };
}

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("CLERK_WEBHOOK_SECRET not configured", { status: 500 });
  }

  const hdrs = await headers();
  const svixId = hdrs.get("svix-id");
  const svixTimestamp = hdrs.get("svix-timestamp");
  const svixSignature = hdrs.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing Svix headers", { status: 400 });
  }

  const payload = await req.text();

  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  // Idempotency: insert the svix-id; if it's already present, this event
  // is a duplicate (Svix retries on non-2xx, network blips can dupe).
  // We return 200 so Svix stops retrying, but skip the handler body.
  try {
    const claim = await db
      .insert(webhookEvents)
      .values({ svixId })
      .onConflictDoNothing()
      .returning({ svixId: webhookEvents.svixId });
    if (claim.length === 0) {
      return new Response("ok (duplicate)", { status: 200 });
    }
  } catch (e) {
    // Don't fail the webhook on idempotency-log issues — better to risk a
    // duplicate handle than to drop the event entirely.
    console.error("[clerk-webhook] idempotency log failed", e);
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const data = event.data as ClerkUserData;
      const email = pickPrimaryEmail(data);
      if (!email) {
        return new Response("User has no email", { status: 400 });
      }
      const { displayName, isReal } = deriveDisplayName(data, email);
      // Filter Clerk's hosted default avatar (purple/indigo blob) — store
      // null instead so the paper-styled initials fallback renders.
      const avatarUrl = normalizeAvatarUrl(data.image_url ?? null);

      // On insert: stamp has_set_display_name from whether Clerk gave us a real
      // name. On update: only overwrite display_name when Clerk now has a real
      // name — otherwise we'd clobber a user who already chose one via
      // /set-name with an email-prefix fallback.
      await db
        .insert(users)
        .values({
          id: data.id,
          email,
          displayName,
          avatarUrl,
          hasSetDisplayName: isReal,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email,
            avatarUrl,
            ...(isReal ? { displayName, hasSetDisplayName: true } : {}),
          },
        });
      // Flip on signup/update may toggle the flag; drop the cached version
      // so server pages don't bounce a freshly-named user to /set-name.
      revalidateTag(USER_DISPLAY_NAME_TAG);
      revalidateTag(USER_PROFILE_TAG);
      break;
    }
    case "user.deleted": {
      const data = event.data as ClerkDeletedData;
      await db.delete(users).where(eq(users.id, data.id));
      revalidateTag(USER_DISPLAY_NAME_TAG);
      revalidateTag(USER_PROFILE_TAG);
      break;
    }
    default:
      // Silently ack unhandled event types — Clerk keeps the webhook healthy.
      break;
  }

  return new Response("ok", { status: 200 });
}
