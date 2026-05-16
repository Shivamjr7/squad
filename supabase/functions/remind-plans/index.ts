// Supabase Edge Function (Deno). Triggered by pg_cron via net.http_post.
// Two responsibilities:
//   1. Auto-lock decide_by-elapsed plans (both open-time and exact-time).
//   2. Fire plan-reminder notifications (in-app rows + Web Push) for
//      confirmed plans starting within the next hour.
//
// M31 — every Resend send was ripped out. Push is the only out-of-app
// channel. M31.6 will (a) emit `plan_locked` notifications from the auto-
// lock branches, and (b) tighten the reminder window from 60m to 40–50m and
// switch the kind to `plan_leave_soon` gated by leave_push_sent_at.
//
// Cadence: pg_cron's existing hourly schedule still works — the
// reminder_sent_at column prevents re-sends on later ticks. If the user
// later tightens pg_cron to every ~5-10 min, the window below stays valid
// (and reminders just land closer to true T-30m).
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
      // M31.6 will emit a `plan_locked` notification + push to the recipient
      // set here, mirroring the in-app auto-lock path in src/lib/actions/auto-lock.ts.
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
      // M31.6 will emit `plan_locked` notification + push for the recipient
      // set here. canonicalStartsAt + canonicalLocation are the payload values.
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

// M30 — fan out a plan-reminder push to every recipient who's IN/MAYBE on
// the plan. Inserts in-app notification rows, then hands the IDs to the
// send-push edge function so subscribers also hear it on their device.
//
// Audience: same as the old email reminder — voters with status in/maybe,
// intersected with the plan_recipients set if present. We don't notify
// `out` voters or non-participants — telling someone "Karaoke at 8" when
// they declined is noise.
async function dispatchPlanReminder(
  plan: ClaimedPlan,
  circleSlug: string,
  circleName: string,
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

  const payload = {
    planId: plan.id,
    planTitle: plan.title,
    circleSlug,
    circleName,
    startsAtIso: plan.starts_at,
    location: plan.location,
  };

  const { data: inserted, error } = await supabase
    .from("notifications")
    .insert(
      userIds.map((userId) => ({
        user_id: userId,
        type: "plan_reminder",
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
  // M30 — reminder window is "starts within the next 60 min". With the
  // existing hourly cron this lands the push 0-60min before start; if the
  // pg_cron schedule is tightened to every 5-10 min, the push lands closer
  // to true T-30m. The reminder_sent_at guard prevents re-sends.
  const upper = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  // Atomic claim. Concurrent firings see reminder_sent_at flip and skip.
  const { data: claimed, error: claimErr } = await supabase
    .from("plans")
    .update({ reminder_sent_at: now.toISOString() })
    .eq("status", "confirmed")
    .lte("starts_at", upper)
    .gte("starts_at", now.toISOString())
    .is("reminder_sent_at", null)
    .select("id, title, starts_at, location, circle_id")
    .returns<ClaimedPlan[]>();

  if (claimErr) {
    console.error("[remind-plans] claim failed", claimErr);
    return new Response(
      JSON.stringify({ error: "claim failed", detail: claimErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let reminded = 0;
  for (const plan of claimed ?? []) {
    try {
      const { data: circle } = await supabase
        .from("circles")
        .select("slug, name")
        .eq("id", plan.circle_id)
        .single();
      if (!circle) continue;
      reminded += await dispatchPlanReminder(plan, circle.slug, circle.name);
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
    reminded,
    locked,
    lockedOpen,
    lockedExact,
    at: now.toISOString(),
  });
  return new Response(JSON.stringify({ reminded, locked }), {
    headers: { "Content-Type": "application/json" },
  });
});
