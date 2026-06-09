"use server";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/db/client";
import { CIRCLE_TAGS } from "@/lib/circles";
import {
  circles,
  memberships,
  planEvents,
  planRecipients,
  planVenues,
  plans,
  suggestionLogItems,
  suggestionLogs,
  timeSlots,
  users,
  votes,
} from "@/db/schema";
import { recordPlanEvent } from "@/lib/actions/plan-events";
import {
  detectAndNotifyConflictsForAudience,
  resolveAllConflictsForPlan,
} from "@/lib/actions/conflict-notify";
import { canModifyPlan, requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  dispatchNotifications,
  resolvePlanAudience,
} from "@/lib/notifications";
import {
  createPlanSchema,
  planIdSchema,
  type CreatePlanInput,
  type PlanIdInput,
} from "@/lib/validation/plan";
import { isValidTimeZone, zonedWallClockToUtc } from "@/lib/tz";
import { captureWinningVenue } from "@/lib/actions/plan-venues";
import { dispatchPlanLockedNotification } from "@/lib/actions/plan-lock-notifications";
import { takeToken, RATE } from "@/lib/rate-limit";

function floorToZonedHour(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).formatToParts(date);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const second = Number(parts.find((p) => p.type === "second")?.value ?? 0);
  return new Date(
    date.getTime() -
      minute * 60_000 -
      second * 1_000 -
      date.getMilliseconds(),
  );
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<{ planId: string; slug: string }> {
  const { userId } = await requireMembership(input.circleId);
  await takeToken({ action: "createPlan", key: userId, ...RATE.createPlan });

  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid plan details.",
    );
  }
  const data = parsed.data;

  if (!isValidTimeZone(data.timeZone)) {
    throw new ActionError("INVALID", "Unrecognized time zone.");
  }

  let startsAt: Date;
  try {
    startsAt = zonedWallClockToUtc(data.startsAtLocal, data.timeZone);
  } catch {
    throw new ActionError("INVALID", "Pick a valid date and time.");
  }

  let decideBy: Date | null = null;
  if (data.decideByLocal) {
    try {
      decideBy = zonedWallClockToUtc(data.decideByLocal, data.timeZone);
    } catch {
      throw new ActionError("INVALID", "Pick a valid deadline.");
    }
    if (decideBy.getTime() >= startsAt.getTime()) {
      throw new ActionError(
        "INVALID",
        "Decide-by must be before the plan's start time.",
      );
    }
  }

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, data.circleId),
  });
  if (!circle) {
    throw new ActionError("NOT_FOUND", "Circle not found.");
  }

  // M23 — resolve and validate recipient set up-front so we can fail fast
  // before writing the plan. Empty array stays empty (= full circle).
  let recipientIds: string[] = [];
  if (data.recipientUserIds.length > 0) {
    // De-dupe and ensure the creator is always in their own plan.
    const requested = new Set<string>(data.recipientUserIds);
    requested.add(userId);
    const requestedArr = Array.from(requested);

    const memberRows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.circleId, data.circleId),
          inArray(memberships.userId, requestedArr),
        ),
      );
    const validIds = new Set(memberRows.map((m) => m.userId));
    if (validIds.size !== requestedArr.length) {
      throw new ActionError(
        "INVALID",
        "One or more recipients aren't in this circle.",
      );
    }
    recipientIds = requestedArr;
  }

  // Eligible voter count = explicit recipients if set, else full circle.
  // The creator may pass an explicit lockThreshold via the "Locks when"
  // chips in NewPlanForm; we always re-clamp on the server so a stale
  // form value or a tampered request can't request an unreachable
  // threshold like 7-of-4. When omitted, default to min(5, eligibleVoters).
  let eligibleVoters: number;
  if (recipientIds.length > 0) {
    eligibleVoters = recipientIds.length;
  } else {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.circleId, data.circleId));
    eligibleVoters = row?.n ?? 1;
  }
  if (eligibleVoters < 2) {
    throw new ActionError(
      "INVALID",
      "Invite at least one other person to create a plan.",
    );
  }
  const requestedThreshold = data.lockThreshold ?? Math.min(5, eligibleVoters);
  const lockThreshold = Math.max(
    1,
    Math.min(requestedThreshold, eligibleVoters),
  );

  const planId = await db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({
        circleId: data.circleId,
        title: data.title,
        type: data.type,
        timeZone: data.timeZone,
        timeMode: data.timeMode,
        startsAt,
        isApproximate: data.isApproximate,
        location: data.location,
        maxPeople: data.maxPeople,
        decideBy,
        createdBy: userId,
        status: "active",
        lockThreshold,
        vibe: data.vibe,
      })
      .returning({ id: plans.id });

    if (!plan) {
      throw new ActionError("INVALID", "Failed to create plan.");
    }

    // Creator's vote auto-set to 'in' per PLAN.md §6 Flow C step 4.
    await tx.insert(votes).values({
      planId: plan.id,
      userId,
      status: "in",
    });

    // M23 — write recipient rows when a subset was picked. Empty intentionally
    // means "full circle" (back-compat with pre-M23 plans).
    if (recipientIds.length > 0) {
      await tx.insert(planRecipients).values(
        recipientIds.map((uid) => ({ planId: plan.id, userId: uid })),
      );
    }

    // M24 — open the activity log with the creation event. Same transaction
    // so the receipt invariant "every plan has at least one `created` event"
    // holds even if a later step fails and rolls back the plan.
    await tx.insert(planEvents).values({
      planId: plan.id,
      userId,
      kind: "created",
      payload: { title: data.title, type: data.type },
    });

    // M21 + Suggest Plan (Option A): seed plan_venues whenever the creator
    // added extra venue options OR picked a suggestion from the drawer. The
    // pure single-venue path (one location, no extras, no suggestions)
    // keeps writing only to plans.location so the existing maps/email
    // shortcut and "voting hidden" UI invariant hold.
    //
    // Suggestion rows carry `source='suggestion'` + `suggestion_item_id`.
    // The item id is verified against suggestion_log_items first; rows
    // whose item is unresolvable fall back to `source='manual'` and we
    // emit a `suggestion_added` plan_event with `payload.warning =
    // 'item_unresolved'` (10-edge-cases.md §Race conditions).
    const requestedItemIds = data.suggestions.map((s) => s.itemId);
    const resolvedItemIds = new Set<string>();
    if (requestedItemIds.length > 0) {
      // Scope item resolution to the caller's own suggestion logs in this
      // circle. Without the join an attacker could quote any leaked itemId
      // (e.g., from another circle they're not a member of) and link the
      // suggestion to a plan they create — cross-circle suggestion IDOR.
      const rows = await tx
        .select({ id: suggestionLogItems.id })
        .from(suggestionLogItems)
        .innerJoin(
          suggestionLogs,
          eq(suggestionLogItems.logId, suggestionLogs.id),
        )
        .where(
          and(
            inArray(suggestionLogItems.id, requestedItemIds),
            eq(suggestionLogs.userId, userId),
            eq(suggestionLogs.circleId, data.circleId),
          ),
        );
      for (const r of rows) resolvedItemIds.add(r.id);
    }

    type SeedRow = {
      label: string;
      source: "manual" | "suggestion";
      suggestionItemId: string | null;
    };
    const seedMap = new Map<string, SeedRow>();
    const insertionOrder: string[] = [];
    const addLabel = (
      rawLabel: string | null | undefined,
      provenance?: { itemId: string },
    ) => {
      const key = rawLabel?.trim();
      if (!key) return;
      const isResolvedSuggestion =
        provenance != null && resolvedItemIds.has(provenance.itemId);
      const existing = seedMap.get(key);
      if (existing) {
        // Upgrade an earlier manual row when a matching suggestion lands.
        if (isResolvedSuggestion && existing.source !== "suggestion") {
          existing.source = "suggestion";
          existing.suggestionItemId = provenance!.itemId;
        }
        return;
      }
      seedMap.set(key, {
        label: key,
        source: isResolvedSuggestion ? "suggestion" : "manual",
        suggestionItemId: isResolvedSuggestion ? provenance!.itemId : null,
      });
      insertionOrder.push(key);
    };

    if (data.location) addLabel(data.location);
    for (const ex of data.extraVenues) addLabel(ex);
    for (const s of data.suggestions) addLabel(s.label, { itemId: s.itemId });

    const shouldSeedVenues =
      data.extraVenues.length > 0 || data.suggestions.length > 0;

    if (shouldSeedVenues && seedMap.size > 0) {
      await tx.insert(planVenues).values(
        insertionOrder.map((key) => {
          const row = seedMap.get(key)!;
          return {
            planId: plan.id,
            label: row.label,
            suggestedBy: userId,
            source: row.source,
            suggestionItemId: row.suggestionItemId,
          };
        }),
      );
    }

    // Plan-event timeline: one row per accepted suggestion. Unresolved
    // items still get an event so the audit log records the attempt; the
    // warning flag lets dashboards distinguish from clean adds.
    for (const s of data.suggestions) {
      const resolved = resolvedItemIds.has(s.itemId);
      await tx.insert(planEvents).values({
        planId: plan.id,
        userId,
        kind: "suggestion_added",
        payload: resolved
          ? { suggestionLogId: s.suggestionLogId, itemId: s.itemId }
          : {
              suggestionLogId: s.suggestionLogId,
              itemId: s.itemId,
              warning: "item_unresolved",
            },
      });
    }

    // Close the loop on suggestion_logs.planId so lifecycle hooks (auto-
    // lock 'won', cancelPlan 'cancelled') + any post-create recordFeedback
    // calls can find the right plan. Guarded with isNull so re-creation
    // never silently relinks an older log to a newer plan.
    const uniqueLogIds = Array.from(
      new Set(data.suggestions.map((s) => s.suggestionLogId)),
    );
    if (uniqueLogIds.length > 0) {
      await tx
        .update(suggestionLogs)
        .set({ planId: plan.id })
        .where(
          and(
            inArray(suggestionLogs.id, uniqueLogIds),
            isNull(suggestionLogs.planId),
          ),
        );
    }

    // Open-time mode: seed 5 hourly slots anchored on the picked startsAt.
    // Slots run from (startsAt - 2h) through (startsAt + 2h), one per hour.
    // Anchored on a top-of-hour boundary so cells line up cleanly with
    // wall-clock labels in the heatmap.
    if (data.timeMode === "open") {
      const topOfHourMs = floorToZonedHour(
        startsAt,
        data.timeZone,
      ).getTime();
      const seedRows = [];
      for (let i = -2; i <= 2; i++) {
        seedRows.push({
          planId: plan.id,
          startsAt: new Date(topOfHourMs + i * 60 * 60_000),
          durationMinutes: 60,
        });
      }
      await tx.insert(timeSlots).values(seedRows);
    }

    return plan.id;
  });

  // Plan creation bumps the squad-pulse "last activity" for the creator —
  // invalidate the activity cache so the home strip reflects it.
  revalidateTag(CIRCLE_TAGS.circleActivity);

  // Router-cache bust for the cross-circle home + per-circle Plans tab so
  // the new plan shows up immediately (and, critically, doesn't render
  // with a stale "needs your vote" pip for the creator — their implicit
  // IN vote is inserted in the same transaction above, but the previously
  // rendered HTML wouldn't reflect it without an explicit revalidate).
  revalidatePath("/");
  revalidatePath(`/c/${circle.slug}`);
  revalidatePath(`/c/${circle.slug}/plans`);

  // M30 — drop a plan_created notification on every recipient. Recipient set
  // if non-empty, else full circle; the creator is excluded since they
  // obviously know. Push is the only channel now (M31 ripped out Resend).
  void notifyPlanCreated({
    planId,
    circleId: data.circleId,
    circleSlug: circle.slug,
    title: data.title,
    creatorId: userId,
  }).catch((err) => {
    console.error("[plans.createPlan] notify fanout failed", err);
  });

  // M32.7 — conflict detection across the full audience (creator + every
  // recipient, or creator + full-circle when no recipient subset was
  // picked). Creator gets the dispatch too because their auto-vote IN means
  // they immediately hold a commitment to the new plan, and that commitment
  // might collide with one of their existing plans.
  void (async () => {
    try {
      const audienceWithCreator = await resolvePlanAudience(
        planId,
        data.circleId,
        null,
      );
      await detectAndNotifyConflictsForAudience(planId, audienceWithCreator);
    } catch (err) {
      console.error("[plans.createPlan] conflict detect failed", err);
    }
  })();

  return { planId, slug: circle.slug };
}

async function notifyPlanCreated(args: {
  planId: string;
  circleId: string;
  circleSlug: string;
  title: string;
  creatorId: string;
}): Promise<void> {
  const [circle, creator, audience] = await Promise.all([
    db.query.circles.findFirst({
      columns: { name: true },
      where: eq(circles.id, args.circleId),
    }),
    db.query.users.findFirst({
      columns: { displayName: true },
      where: eq(users.id, args.creatorId),
    }),
    resolvePlanAudience(args.planId, args.circleId, args.creatorId),
  ]);
  if (!circle || audience.length === 0) return;

  await dispatchNotifications({
    type: "plan_created",
    userIds: audience,
    payload: {
      planId: args.planId,
      planTitle: args.title,
      circleSlug: args.circleSlug,
      circleName: circle.name,
      creatorName: creator?.displayName ?? "Someone",
      creatorId: args.creatorId,
    },
  });
}

// Router-cache bust for the surfaces a status change affects: the
// cross-circle home (counts for deciding / locked / needs-vote), the
// per-circle home, and the per-circle Plans tab. The plan detail page
// gets a `router.refresh()` from its overflow menu, so this doesn't
// need to revalidate it.
async function revalidateHomeForCircle(circleId: string): Promise<void> {
  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, circleId),
  });
  revalidatePath("/");
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}`);
    revalidatePath(`/c/${circle.slug}/plans`);
  }
}

// Shared auth + lookup for the three status mutations. Caller-or-admin
// authorization per PLAN.md §6 Flow F. Returns the plan row so the action
// can read current state for state-machine guards and (later) wire emails.
async function loadPlanForStatusChange(input: PlanIdInput) {
  const parsed = planIdSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError("INVALID", "Invalid plan id.");
  }
  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      createdBy: true,
      status: true,
      title: true,
      startsAt: true,
      timeZone: true,
    },
    where: eq(plans.id, parsed.data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  const { userId, role } = await requireMembership(plan.circleId);
  if (!canModifyPlan(plan, userId, { role })) {
    throw new ActionError(
      "FORBIDDEN",
      "Only the plan's creator or a circle admin can change its status.",
    );
  }
  return { plan, userId };
}

export async function markPlanDone(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "Only active or confirmed plans can be marked done.",
    );
  }
  await db
    .update(plans)
    .set({ status: "done", cancelledAt: null })
    .where(eq(plans.id, plan.id));

  await revalidateHomeForCircle(plan.circleId);

  // M32.7 — `done` is a terminal status, same as `cancelled` for the
  // purpose of being a hard commitment. Resolve every ledger row pairing
  // this plan with another. Status flipped → it's no longer eligible.
  void resolveAllConflictsForPlan(plan.id).catch((err) => {
    console.error("[plans.markPlanDone] conflict resolve failed", err);
  });
}

export async function cancelPlan(input: PlanIdInput): Promise<void> {
  const { plan, userId } = await loadPlanForStatusChange(input);
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "Only active or confirmed plans can be cancelled.",
    );
  }
  await db
    .update(plans)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(plans.id, plan.id));

  await revalidateHomeForCircle(plan.circleId);

  void recordPlanEvent({
    planId: plan.id,
    userId,
    kind: "cancelled",
    payload: null,
  });

  // S7 — close the loop on any suggestion-sourced venues that were
  // attached to this plan. Best-effort: a failed write must not break
  // cancel email/notification fanout.
  void (async () => {
    try {
      const suggestionVenues = await db
        .select({ suggestionItemId: planVenues.suggestionItemId })
        .from(planVenues)
        .where(
          and(
            eq(planVenues.planId, plan.id),
            eq(planVenues.source, "suggestion"),
            isNotNull(planVenues.suggestionItemId),
          ),
        );
      const itemIds = suggestionVenues
        .map((v) => v.suggestionItemId)
        .filter((id): id is string => id !== null);
      if (itemIds.length === 0) return;
      await db
        .update(suggestionLogItems)
        .set({ feedback: "cancelled", feedbackAt: new Date() })
        .where(inArray(suggestionLogItems.id, itemIds));
    } catch (err) {
      console.error("[plans.cancelPlan] suggestion feedback=cancelled failed", err);
    }
  })();

  // M31.6 — fan out the "Plan off" push. Tag mirrors plan_locked
  // (`plan:{id}:state`) so the OS shade replaces any prior "It's happening"
  // bubble with this cancellation. Actor (canceller) is excluded — they just
  // performed the action and don't need to be told what they did.
  void dispatchPlanCancelledNotification({
    planId: plan.id,
    circleId: plan.circleId,
    cancellerId: userId,
  });

  // M32.7 — cancelled plan is no longer a commitment; clear ledger rows
  // and let resolution pushes ride the OS tag back over the conflict
  // bubbles. The 7-day window inside `resolveAllConflictsForPlan` filters
  // stale pairs so we don't push to undo notifications the user never got.
  void resolveAllConflictsForPlan(plan.id).catch((err) => {
    console.error("[plans.cancelPlan] conflict resolve failed", err);
  });
}

async function dispatchPlanCancelledNotification(args: {
  planId: string;
  circleId: string;
  cancellerId: string;
}): Promise<void> {
  try {
    const [planRow, circle, canceller, audience] = await Promise.all([
      db.query.plans.findFirst({
        columns: { title: true },
        where: eq(plans.id, args.planId),
      }),
      db.query.circles.findFirst({
        columns: { slug: true, name: true },
        where: eq(circles.id, args.circleId),
      }),
      db.query.users.findFirst({
        columns: { displayName: true },
        where: eq(users.id, args.cancellerId),
      }),
      resolvePlanAudience(args.planId, args.circleId, args.cancellerId),
    ]);
    if (!planRow || !circle || audience.length === 0) return;
    await dispatchNotifications({
      type: "plan_cancelled",
      userIds: audience,
      payload: {
        planId: args.planId,
        planTitle: planRow.title,
        circleSlug: circle.slug,
        circleName: circle.name,
        cancellerName: canceller?.displayName ?? null,
      },
    });
  } catch (err) {
    console.error("[plans.cancelPlan] plan_cancelled dispatch failed", {
      planId: args.planId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function uncancelPlan(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "cancelled") {
    throw new ActionError(
      "INVALID",
      "This plan isn't cancelled.",
    );
  }
  // Per M13 spec: uncancel always returns to `active`, not `confirmed`.
  // We don't track the pre-cancel status, and the spec excludes "remember
  // was-confirmed through cancel cycle" as out-of-scope.
  await db
    .update(plans)
    .set({ status: "active", cancelledAt: null })
    .where(eq(plans.id, plan.id));

  await revalidateHomeForCircle(plan.circleId);
}

export async function confirmPlan(input: PlanIdInput): Promise<void> {
  const { plan, userId } = await loadPlanForStatusChange(input);
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      plan.status === "confirmed"
        ? "This plan is already confirmed."
        : "Only active plans can be confirmed.",
    );
  }
  await db
    .update(plans)
    .set({ status: "confirmed" })
    .where(eq(plans.id, plan.id));

  await revalidateHomeForCircle(plan.circleId);

  // M21 — promote leading venue (if any) to plans.location on lock.
  const winningVenue = await captureWinningVenue(plan.id);

  void recordPlanEvent({
    planId: plan.id,
    userId,
    kind: "locked",
    payload: {
      manual: true,
      location: winningVenue,
    },
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true, name: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle) {
    void dispatchPlanLockedNotification({
      planId: plan.id,
      circleId: plan.circleId,
      circleSlug: circle.slug,
      circleName: circle.name,
      startsAt: plan.startsAt,
      timeZone: plan.timeZone,
      location: winningVenue,
      trigger: "forced",
    });
  }

  void (async () => {
    try {
      const audience = await resolvePlanAudience(plan.id, plan.circleId, null);
      await detectAndNotifyConflictsForAudience(plan.id, audience);
    } catch (err) {
      console.error("[plans.confirmPlan] conflict detect failed", err);
    }
  })();
}

export async function unconfirmPlan(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "This plan isn't confirmed.",
    );
  }
  await db
    .update(plans)
    .set({ status: "active" })
    .where(eq(plans.id, plan.id));

  await revalidateHomeForCircle(plan.circleId);
}
