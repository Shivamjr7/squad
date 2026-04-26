import { headers } from "next/headers";
import { Webhook } from "svix";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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

function deriveDisplayName(data: ClerkUserData, email: string): string {
  const full = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (data.username) return data.username;
  return email.split("@")[0] ?? email;
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

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const data = event.data as ClerkUserData;
      const email = pickPrimaryEmail(data);
      if (!email) {
        return new Response("User has no email", { status: 400 });
      }
      const displayName = deriveDisplayName(data, email);
      const avatarUrl = data.image_url ?? null;

      await db
        .insert(users)
        .values({
          id: data.id,
          email,
          displayName,
          avatarUrl,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, displayName, avatarUrl },
        });
      break;
    }
    case "user.deleted": {
      const data = event.data as ClerkDeletedData;
      await db.delete(users).where(eq(users.id, data.id));
      break;
    }
    default:
      // Silently ack unhandled event types — Clerk keeps the webhook healthy.
      break;
  }

  return new Response("ok", { status: 200 });
}
