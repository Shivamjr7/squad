import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side emitter for Supabase Realtime Broadcast. Used by mutating
// server actions after a commit so the corresponding browser-side hooks
// can update without polling. We use Broadcast instead of
// postgres_changes (the original M5 approach) so the anon role never
// needs SELECT access on votes/comments/etc. — Broadcast channels are
// pub/sub messages over a websocket, not table reads, so RLS can stay
// at default-deny without breaking the live UX.
//
// Anon vs service-role: Broadcast doesn't require service-role to send;
// the anon key works. Using the anon key from the server keeps this
// helper deployable even when SUPABASE_SERVICE_ROLE_KEY isn't set.
//
// Trust model: a malicious client with the anon key COULD send fake
// broadcasts to the same channels (anyone subscribed would see a
// spoofed vote/comment update). The DB persistence is unaffected — the
// fake event vanishes on next page load when initial state is fetched
// server-side via Drizzle. Documented as accepted v1 risk in
// SECURITY_PLAN.md. Phase 3 (post-launch) can upgrade to private
// channels with Clerk-Supabase JWT integration.

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 50 } },
  });
  return _client;
}

// Fire-and-forget broadcast. Never throws — a transient Realtime issue
// must not roll back a successful write. The caller should always have
// already committed the underlying mutation before this runs.
export async function emitBroadcast(
  channelName: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    const channel = c.channel(channelName);
    // `send` resolves after the message is acked by the Realtime server.
    // We await it so the function-level transaction (Vercel serverless)
    // doesn't tear down the websocket before the message lands.
    await channel.send({
      type: "broadcast",
      event,
      payload,
    });
    await c.removeChannel(channel);
  } catch {
    // Swallow; broadcast failure is a UX nicety, not data integrity.
  }
}

// ─── Channel name + event name constants ────────────────────────────────
// Centralized so the hooks and actions can't drift apart. Each function
// takes the smallest identifier needed to address the channel — usually a
// planId, occasionally a circleId for cross-plan streams.

export const RT = {
  votes: (planId: string) => `votes:plan:${planId}` as const,
  comments: (planId: string) => `comments:plan:${planId}` as const,
  slotVotes: (planId: string) => `slot-votes:plan:${planId}` as const,
  venues: (planId: string) => `venues:plan:${planId}` as const,
  proposals: (planId: string) => `proposals:plan:${planId}` as const,
} as const;

export const RT_EVENT = {
  voteChanged: "vote.changed",
  commentAdded: "comment.added",
  commentDeleted: "comment.deleted",
  slotVoteChanged: "slot-vote.changed",
  venueChanged: "venue.changed",
  venueVoteChanged: "venue-vote.changed",
  proposalChanged: "proposal.changed",
  proposalVoteChanged: "proposal-vote.changed",
} as const;
