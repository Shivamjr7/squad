"use server";

import { db } from "@/db/client";
import { invites } from "@/db/schema";
import { requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import { generateInviteCode } from "@/lib/invite-code";
import { getAppUrl } from "@/lib/url";

export async function generateInvite(input: {
  circleId: string;
}): Promise<{ url: string; code: string }> {
  const { userId } = await requireMembership(input.circleId, "admin");

  // Collisions on a 12-char base64url code are vanishingly rare; one retry
  // is enough belt-and-braces. Throws if both attempts collide.
  let code = generateInviteCode();
  let attempt = 0;
  while (attempt < 2) {
    try {
      await db.insert(invites).values({
        circleId: input.circleId,
        code,
        createdBy: userId,
      });
      const baseUrl = await getAppUrl();
      return { url: `${baseUrl}/invite/${code}`, code };
    } catch (err) {
      // Postgres unique_violation on invites.code — regenerate and retry once.
      // Drizzle wraps postgres-js errors so the real code lives on .cause.
      const sqlState =
        (err as { code?: string }).code ??
        ((err as { cause?: { code?: string } }).cause?.code);
      if (sqlState === "23505" && attempt === 0) {
        code = generateInviteCode();
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  throw new ActionError("CONFLICT", "Could not generate a unique invite code.");
}
