// Supabase Edge Function (Deno). Triggered by pg_cron via net.http_post.
// Two responsibilities:
//   1. Auto-lock decide_by-elapsed plans (both open-time and exact-time).
//      Each successful lock fires a `plan_locked` notification (M31.6).
//   2. Fire `plan_leave_soon` notifications (in-app rows + Web Push) for
//      confirmed plans whose starts_at falls in the [now+40m, now+50m]
//      window. Dedup via the `leave_push_sent_at` column (M31.1) — the
//      atomic UPDATE+IS NULL claim means a re-fire on a later tick is
//      a no-op.
//
// Cron cadence: with hourly pg_cron the 40–50m window catches plans whose
// starts_at falls within a specific 10-min slice each tick. For reliable
// T-45m delivery, tighten pg_cron to every ~5 min after deploying M31.6.
// The leave_push_sent_at guard makes the tighter cadence safe.
//
// Auth: requires Authorization: Bearer <CRON_SECRET>. The anon key is public
// and not used here — pg_cron passes the custom secret instead.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── helpers ────────────────────────────────────────────────────────────

// M23 — fetch the explicit recipient user_id set for a plan. Returns null
// when there are no rows (back-compat: plan goes to the full circle).
async function getPlanRecipientUserIds(
  planId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("plan_recipients")
    .select("user_id")
    .eq("plan_id", planId)
    .returns<{ user_id: string }[]>();
  if (error) {
    console.error("[remind-plans] recipient lookup failed", {
      planId,
      error: error.message,
    });
    return null;
  }
  if (!data || data.length === 0) return null;
  return new Set(data.map((r) => r.user_id));
}

// Mirrors resolvePlanAudience() from src/lib/notifications.ts but in Deno:
// recipients if non-empty, else full circle membership. The cron has no
// "actor" to exclude — lock / leave-soon are system-driven.
async function resolveAudienceForPlan(
  planId: string,
  circleId: string,
): Promise<string[]> {
  const recipients = await getPlanRecipientUserIds(planId);
  if (recipients !== null) return Array.from(recipients);
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("circle_id", circleId)
    .returns<{ user_id: string }[]>();
  if (error) {
    console.error("[remind-plans] membership lookup failed", {
      circleId,
      error: error.message,
    });
    return [];
  }
  return (data ?? []).map((r) => r.user_id);
}

// Count `in` votes for the lock body copy ("5 of 6 said yes").
async function countInVotes(planId: string): Promise<number> {
  const { count, error } = await supabase
    .from("votes")
    .select("user_id", { count: "exact", head: true })
    .eq("plan_id", planId)
    .eq("status", "in");
  if (error) {
    console.error("[remind-plans] in-vote count failed", {
      planId,
      error: error.message,
    });
    return 0;
  }
  return count ?? 0;
}

// Lock open-time plans whose decide_by has elapsed. Picks the slot with the
// most votes; ties (or zero-vote plans) fall back to earliest starts_at.
// Atomic guard `time_mode = 'open'` prevents racing with the in-app
// threshold-driven lock path.
type OpenPlan = {
  id: string;
  title: string;
  location: string | null;
  circle_id: string;
};

type SlotRow = { id: string; starts_at: string };
type SlotCountRow = { slot_id: string };

async function processOpenTimeLocks(now: Date): Promise<number> {
  const cutoff = now.toISOString();
  const { data: openPlans, error } = await supabase
    .from("plans")
    .select("id, title, location, circle_id")
    .eq("time_mode", "open")
    .eq("status", "active")
    .not("decide_by", "is", null)
    .lte("decide_by", cutoff)
    .returns<OpenPlan[]>();

  if (error) {
    console.error("[remind-plans] open-lock fetch failed", error);
    return 0;
  }
  if (!openPlans || openPlans.length === 0) return 0;

  let locked = 0;
  for (const plan of openPlans) {
    try {
      const { data: slots } = await supabase
        .from("time_slots")
        .select("id, starts_at")
        .eq("plan_id", plan.id)
        .order("starts_at", { ascending: true })
        .returns<SlotRow[]>();
      if (!slots || slots.length === 0) continue;

      const slotIds = slots.map((s) => s.id);
      const { data: voteRows } = await supabase
        .from("time_slot_votes")
        .select("slot_id")
        .in("slot_id", slotIds)
        .returns<SlotCountRow[]>();

      const counts = new Map<string, number>();
      for (const r of voteRows ?? []) {
        counts.set(r.slot_id, (counts.get(r.slot_id) ?? 0) + 1);
      }

      // Slots already sorted earliest-first; max-by count keeps the earliest
      // on ties (including the zero-vote case where everything is 0).
      let winner: SlotRow = slots[0];
      let winnerCount = counts.get(winner.id) ?? 0;
      for (let i = 1; i < slots.length; i++) {
        const c = counts.get(slots[i].id) ?? 0;
        if (c > winnerCount) {
          winner = slots[i];
          winnerCount = c;
        }
      }

      const { data: claim } = await supabase
        .from("plans")
        .update({
          starts_at: winner.starts_at,
          time_mode: "exact",
          status: "confirmed",
        })
        .eq("id", plan.id)
        .eq("time_mode", "open")
        .select("id")
        .returns<{ id: string }[]>();
      if (!claim || claim.length === 0) continue;
      // M31.6 — emit `plan_locked` notification + push. trigger='forced'
      // because the deadline reaper is what's flipping it (the in-app
      // threshold path would have already fired its own notification).
      await dispatchPlanLocked({
        planId: plan.id,
        circleId: plan.circle_id,
        title: plan.title,
        startsAtIso: winner.starts_at,
        location: plan.location,
        trigger: "forced",
      });
      locked += 1;
    } catch (err) {
      console.error("[remind-plans] open-lock per-plan failed", {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return locked;
}

// M22 — Exact-time deadline reaper. For exact-time plans whose decide_by
// has elapsed, lock to the canonical (time, venue): leading proposal wins
// the time, leading venue wins the location, ties broken by earliest-
// proposed (createdAt asc). When no rows / no votes, plan.starts_at and
// plan.location stand. Mirrors src/lib/actions/auto-lock.ts (force path).
type ExactPlan = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  circle_id: string;
};
type ProposalRow = { id: string; starts_at: string; created_at: string };
type ProposalVoteRow = { proposal_id: string };
type VenueRow = { id: string; label: string; created_at: string };
type VenueVoteRow = { venue_id: string };

function resolvePlurality<
  T extends { id: string; createdAt: string },
>(rows: T[], counts: Map<string, number>): T | null {
  if (rows.length === 0) return null;
  // rows are pre-sorted earliest-first, so max-by count keeps the earliest
  // on ties (force path doesn't require a unique leader).
  let leader = rows[0];
  let leaderVotes = counts.get(leader.id) ?? 0;
  for (let i = 1; i < rows.length; i++) {
    const c = counts.get(rows[i].id) ?? 0;
    if (c > leaderVotes) {
      leader = rows[i];
      leaderVotes = c;
    }
  }
  return leader;
}

async function processExactTimeLocks(now: Date): Promise<number> {
  const cutoff = now.toISOString();
  const { data: exactPlans, error } = await supabase
    .from("plans")
    .select("id, title, starts_at, location, circle_id")
    .eq("time_mode", "exact")
    .eq("status", "active")
    .not("decide_by", "is", null)
    .lte("decide_by", cutoff)
    .returns<ExactPlan[]>();

  if (error) {
    console.error("[remind-plans] exact-lock fetch failed", error);
    return 0;
  }
  if (!exactPlans || exactPlans.length === 0) return 0;

  let locked = 0;
  for (const plan of exactPlans) {
    try {
      // Canonical time.
      const { data: proposals } = await supabase
        .from("plan_time_proposals")
        .select("id, starts_at, created_at")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: true })
        .returns<ProposalRow[]>();

      let canonicalStartsAt = plan.starts_at;
      if (proposals && proposals.length > 0) {
        const ids = proposals.map((p) => p.id);
        const { data: pVotes } = await supabase
          .from("plan_time_proposal_votes")
          .select("proposal_id")
          .in("proposal_id", ids)
          .returns<ProposalVoteRow[]>();
        const counts = new Map<string, number>();
        for (const r of pVotes ?? []) {
          counts.set(r.proposal_id, (counts.get(r.proposal_id) ?? 0) + 1);
        }
        const leader = resolvePlurality(
          proposals.map((p) => ({
            id: p.id,
            createdAt: p.created_at,
            startsAt: p.starts_at,
          })),
          counts,
        );
        if (leader) canonicalStartsAt = leader.startsAt;
      }

      // Canonical venue.
      const { data: venues } = await supabase
        .from("plan_venues")
        .select("id, label, created_at")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: true })
        .returns<VenueRow[]>();

      let canonicalLocation = plan.location;
      if (venues && venues.length > 0) {
        const ids = venues.map((v) => v.id);
        const { data: vVotes } = await supabase
          .from("plan_venue_votes")
          .select("venue_id")
          .in("venue_id", ids)
          .returns<VenueVoteRow[]>();
        const counts = new Map<string, number>();
        for (const r of vVotes ?? []) {
          counts.set(r.venue_id, (counts.get(r.venue_id) ?? 0) + 1);
        }
        const leader = resolvePlurality(
          venues.map((v) => ({
            id: v.id,
            createdAt: v.created_at,
            label: v.label,
          })),
          counts,
        );
        if (leader) canonicalLocation = leader.label;
      }

      // Atomic flip — guard on status='active' so we don't race the
      // in-app threshold path.
      const { data: claim } = await supabase
        .from("plans")
        .update({
          starts_at: canonicalStartsAt,
          location: canonicalLocation,
          status: "confirmed",
        })
        .eq("id", plan.id)
        .eq("status", "active")
        .select("id")
        .returns<{ id: string }[]>();
      if (!claim || claim.length === 0) continue;
      // M31.6 — emit `plan_locked` notification + push.
      await dispatchPlanLocked({
        planId: plan.id,
        circleId: plan.circle_id,
        title: plan.title,
        startsAtIso: canonicalStartsAt,
        location: canonicalLocation,
        trigger: "forced",
      });
      locked += 1;
    } catch (err) {
      console.error("[remind-plans] exact-lock per-plan failed", {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return locked;
}

// ─── handler ────────────────────────────────────────────────────────────

type ClaimedPlan = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  circle_id: string;
};

type VoterRow = { user_id: string };

// M31.6 — fan out the "Leave in ~45m" push to in/maybe voters intersected
// with the plan_recipients set (full circle when there's no explicit
// recipient list). out / non-voters aren't pulled in — telling someone
// "Karaoke at 8" when they declined is noise. Inserts in-app notification
// rows, then hands the IDs to the send-push edge function.
async function dispatchPlanLeaveSoon(
  plan: ClaimedPlan,
  circleSlug: string,
  circleName: string,
  now: Date,
): Promise<number> {
  const { data: voterRows } = await supabase
    .from("votes")
    .select("user_id")
    .eq("plan_id", plan.id)
    .in("status", ["in", "maybe"])
    .returns<VoterRow[]>();
  if (!voterRows || voterRows.length === 0) return 0;

  const recipientFilter = await getPlanRecipientUserIds(plan.id);
  const userIds = voterRows
    .map((v) => v.user_id)
    .filter((id) =>
      recipientFilter === null ? true : recipientFilter.has(id),
    );
  if (userIds.length === 0) return 0;

  // Composer rounds to 5 — pass the raw minutes and let it bucket the copy.
  const startsMs = new Date(plan.starts_at).getTime();
  const minutesUntilStart = Math.max(
    0,
    Math.round((startsMs - now.getTime()) / 60_000),
  );

  const payload = {
    planId: plan.id,
    planTitle: plan.title,
    circleSlug,
    circleName,
    startsAtIso: plan.starts_at,
    location: plan.location,
    minutesUntilStart,
  };

  const { data: inserted, error } = await supabase
    .from("notifications")
    .insert(
      userIds.map((userId) => ({
        user_id: userId,
        type: "plan_leave_soon",
        payload,
      })),
    )
    .select("id")
    .returns<{ id: string }[]>();
  if (error) {
    console.error("[remind-plans] notification insert failed", {
      planId: plan.id,
      error: error.message,
    });
    return 0;
  }
  if (!inserted || inserted.length === 0) return 0;

  await invokeSendPush(inserted.map((r) => r.id));
  return inserted.length;
}

// M31.6 — fan out the "It's happening" push when the cron locks a plan
// (open-time or exact-time). System-driven, so audience = full
// recipients-or-circle (no actor exclusion). Mirrors the in-app dispatch
// in src/lib/actions/auto-lock.ts.
async function dispatchPlanLocked(args: {
  planId: string;
  circleId: string;
  title: string;
  startsAtIso: string;
  location: string | null;
  trigger: "threshold" | "forced" | "all_voted";
}): Promise<number> {
  const [audience, inCount, circle] = await Promise.all([
    resolveAudienceForPlan(args.planId, args.circleId),
    countInVotes(args.planId),
    supabase
      .from("circles")
      .select("slug, name")
      .eq("id", args.circleId)
      .single<{ slug: string; name: string }>(),
  ]);
  if (audience.length === 0 || circle.error || !circle.data) return 0;

  const payload = {
    planId: args.planId,
    planTitle: args.title,
    circleSlug: circle.data.slug,
    circleName: circle.data.name,
    startsAtIso: args.startsAtIso,
    location: args.location,
    inCount,
    totalRecipients: audience.length,
    trigger: args.trigger,
  };

  const { data: inserted, error } = await supabase
    .from("notifications")
    .insert(
      audience.map((userId) => ({
        user_id: userId,
        type: "plan_locked",
        payload,
      })),
    )
    .select("id")
    .returns<{ id: string }[]>();
  if (error) {
    console.error("[remind-plans] plan_locked insert failed", {
      planId: args.planId,
      error: error.message,
    });
    return 0;
  }
  if (!inserted || inserted.length === 0) return 0;

  await invokeSendPush(inserted.map((r) => r.id));
  return inserted.length;
}

async function invokeSendPush(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationIds }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[remind-plans] send-push non-2xx", {
        status: res.status,
        body,
      });
    }
  } catch (err) {
    console.warn("[remind-plans] send-push fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

Deno.serve(async (req) => {
  if (!CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  // M31.6 — "Leave in ~45m" window. Strict 40–50 min ahead, dedup'd via
  // leave_push_sent_at. With hourly cron the catch rate is ~17%; bump
  // pg_cron to every 5 min for ~100% coverage. The atomic UPDATE+IS NULL
  // guard makes the tighter cadence safe — concurrent firings race for
  // the stamp and the loser sees an empty result set.
  const lower = new Date(now.getTime() + 40 * 60 * 1000).toISOString();
  const upper = new Date(now.getTime() + 50 * 60 * 1000).toISOString();

  const { data: claimed, error: claimErr } = await supabase
    .from("plans")
    .update({ leave_push_sent_at: now.toISOString() })
    .eq("status", "confirmed")
    .gte("starts_at", lower)
    .lte("starts_at", upper)
    .is("leave_push_sent_at", null)
    .select("id, title, starts_at, location, circle_id")
    .returns<ClaimedPlan[]>();

  if (claimErr) {
    console.error("[remind-plans] claim failed", claimErr);
    return new Response(
      JSON.stringify({ error: "claim failed", detail: claimErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let leaveSoon = 0;
  for (const plan of claimed ?? []) {
    try {
      const { data: circle } = await supabase
        .from("circles")
        .select("slug, name")
        .eq("id", plan.circle_id)
        .single();
      if (!circle) continue;
      leaveSoon += await dispatchPlanLeaveSoon(
        plan,
        circle.slug,
        circle.name,
        now,
      );
    } catch (err) {
      console.error("[remind-plans] per-plan failed", {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const lockedOpen = await processOpenTimeLocks(now);
  const lockedExact = await processExactTimeLocks(now);
  const locked = lockedOpen + lockedExact;

  console.log("[remind-plans]", {
    leaveSoon,
    locked,
    lockedOpen,
    lockedExact,
    at: now.toISOString(),
  });
  return new Response(JSON.stringify({ leaveSoon, locked }), {
    headers: { "Content-Type": "application/json" },
  });
});
