"use server";

// Suggest Plan — server action layer (S5). Wires the S4 recommendation
// pipeline behind the API contracts in docs/specs/suggest-plan/05-api-contracts.md.
//
// This file is intentionally thin: parse → auth → rate-limit → idempotency
// check → hydrate context → runPipeline → persist log + items → respond.
// All recommendation logic lives under src/lib/suggest/pipeline/*; the
// action only orchestrates I/O and DB persistence.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  memberships,
  planVenues,
  plans,
  suggestionLogItems,
  suggestionLogs,
} from "@/db/schema";
import { ActionError } from "@/lib/actions/errors";
import { recordPlanEvent } from "@/lib/actions/plan-events";
import { requireMembership, requireUserId } from "@/lib/auth";
import { isValidTimeZone, zonedWallClockToUtc } from "@/lib/tz";
import { takeToken } from "@/lib/suggest/rate-limit";
// Side-effect import: registers every available provider into the registry
// at first action invocation. Without this, getProvider() returns null and
// every category degrades with reason='no_provider'.
import "@/lib/suggest/providers";
import {
  gatherContext,
  runPipeline,
} from "@/lib/suggest/pipeline";
import { explain } from "@/lib/suggest/pipeline/explain";
import { confidenceLabel } from "@/lib/suggest/pipeline/rank";
import { effectiveCentroid } from "@/lib/suggest/pipeline/normalize";
import { getWeatherProvider } from "@/lib/suggest/providers/weather-registry";
import { loadWeights } from "@/lib/suggest/weights";
import type {
  Activity,
  RankedResult,
  RecommendationResult,
  ScoreBreakdown,
  SuggestionContext,
  WeatherSnapshot,
} from "@/lib/suggest/types";
import {
  getSuggestionsSchema,
  recordFeedbackSchema,
  type GetSuggestionsInput,
  type RecordFeedbackInput,
} from "@/lib/validation/suggest";

// Privacy: lat/lng stored in suggestion_logs.context is quantized so we
// never persist device-precise coordinates. 3 decimals ≈ 110 m — coarse
// enough that the row alone can't fingerprint a household, fine enough to
// re-rank or debug. Mirrors the geohash-6 intent in 09-data-model.md.
const GEO_QUANTIZE_DECIMALS = 3;

// Fallback centroid resolution from recent plan_venues geocodes when the
// circle has no home_lat/lng yet (per 06-recommendation-pipeline.md §3).
const CENTROID_FALLBACK_VENUE_LIMIT = 10;

// Drop client-supplied geo if accuracy is worse than this (per
// 10-edge-cases.md §Privacy). Tuned to 50 km so desktop wifi-based geo
// (commonly 1–20 km accurate) is trusted instead of silently falling
// back to the circle centroid — the drawer's UX is "show me what's near
// where I actually am." Mobile/GPS readings come in well under this.
const GEO_ACCURACY_CUTOFF_M = 50_000;

// Hard ceiling on the WeatherProvider call. The provider has its own 1.5s
// soft timeout; this is the belt-and-suspenders bound mirroring the per-
// activity-provider HARD_TIMEOUT_MS in pipeline/fetch-activities.ts.
const WEATHER_HARD_TIMEOUT_MS = 3_000;

// Types are intentionally NOT re-exported here. Files with the "use server"
// directive may only export async functions at runtime — type-only re-exports
// survive TS but blow up under turbopack as `undefined` value exports. Import
// `GetSuggestionsInput` / `RecordFeedbackInput` directly from
// `@/lib/validation/suggest` instead.

// ─── getSuggestions ─────────────────────────────────────────────────────

export async function getSuggestions(
  input: GetSuggestionsInput,
): Promise<RecommendationResult> {
  // 1. Validate first so we can return INVALID without a DB hit. Auth check
  //    comes after so an unauthenticated caller still sees INVALID for
  //    malformed payloads (zod is cheap; auth is a network call).
  const parsed = getSuggestionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid suggestion request.",
    );
  }
  const data = parsed.data;

  if (!isValidTimeZone(data.timeZone)) {
    throw new ActionError("INVALID", "Unrecognized time zone.");
  }

  // 2. Auth + membership. requireMembership throws ActionError(UNAUTHORIZED|
  //    FORBIDDEN), matching the spec's error codes verbatim.
  const { userId } = await requireMembership(data.circleId);

  // 3. Rate limit per user (in-process token bucket).
  const rl = takeToken(userId);
  if (!rl.ok) {
    throw new ActionError(
      "RATE_LIMITED",
      "Too many suggestion requests — try again in a moment.",
    );
  }

  // 4. Idempotency: same (userId, requestNonce) returns the stored shape.
  //    The unique index guarantees we never insert two logs for the same
  //    nonce, so this lookup is the only correct path for repeats.
  const existing = await loadExistingLog(userId, data.requestNonce);
  if (existing) {
    return existing;
  }

  // 5. Resolve UTC time window from wall-clock + TZ (reuses the same
  //    helper plan creation uses, so the two flows agree on instants).
  let startsAt: Date;
  try {
    startsAt = zonedWallClockToUtc(data.startsAtLocal, data.timeZone);
  } catch {
    throw new ActionError("INVALID", "Pick a valid date and time.");
  }

  // 6. Centroid: prefer circles.home_lat/lng. Fall back to the centroid of
  //    the last N geocoded plan_venues. Null is fine — the pipeline runs
  //    in category-only mode (10-edge-cases.md §empty results).
  const circleCentroid = await resolveCircleCentroid(data.circleId);

  // 7. Filter recipient list to actual members (silent — per
  //    10-edge-cases.md §invalid filters, racing membership changes must
  //    not surface as INVALID).
  const recipientUserIds = await filterToMembers(
    data.circleId,
    data.recipientUserIds,
  );

  // 8. Drop low-accuracy geo per 10-edge-cases.md §Privacy.
  const trustedGeo =
    data.geo &&
    (data.geo.accuracyMeters === undefined ||
      data.geo.accuracyMeters <= GEO_ACCURACY_CUTOFF_M)
      ? data.geo
      : undefined;

  // 9. Assemble SuggestionContext. groupPreferences is intentionally
  //    omitted so gatherContext substitutes the neutral profile — the
  //    DB-backed aggregator lands in S6+.
  const ctxNoWeather = gatherContext({
    circleId: data.circleId,
    userId,
    planType: data.planType,
    startsAtUtc: startsAt.toISOString(),
    isApproximate: data.isApproximate,
    timeZone: data.timeZone,
    geo: trustedGeo,
    circleCentroid,
    distanceKmCap: data.distanceKmCap,
    budgetTier: data.budgetTier,
    excludeIds: data.excludeIds,
    recipientUserIds,
    requestNonce: data.requestNonce,
  });

  // 9b. Weather (S9). Best-effort: a failed/null forecast collapses the
  //     weather component to the neutral defaults in score.ts. The provider
  //     itself implements 1.5s soft timeout + breaker; we add a 3s hard
  //     bound to be safe. Degraded entries appended to result.degraded
  //     below so the UI footnote can render "weather unavailable".
  const { weather, weatherDegraded } = await fetchWeather(ctxNoWeather);
  const ctx: SuggestionContext = weather
    ? { ...ctxNoWeather, weather }
    : ctxNoWeather;

  // 10. Run pipeline (pure orchestrator — provider I/O is isolated inside).
  const weights = loadWeights();
  const result = await runPipeline(ctx, { limit: data.limit });
  if (weatherDegraded) {
    result.degraded = [...(result.degraded ?? []), weatherDegraded];
  }

  // 11. Persist: one log + one row per result, in a single transaction so
  //     a half-written log can never surface as a stale id.
  const outcome = deriveOutcome(result, ctx);
  await persistLog({ ctx, result, weights, outcome });

  return result;
}

// ─── refreshSuggestions ─────────────────────────────────────────────────

// Thin wrapper. Spec (05-api-contracts.md §Pagination) explicitly states
// refresh is "same pipeline; excludeIds populated from the previous run's
// ids" — so this exists as a named API surface, but the implementation is
// just getSuggestions. Keeps the drawer's call site self-documenting.
export async function refreshSuggestions(
  input: GetSuggestionsInput,
): Promise<RecommendationResult> {
  return getSuggestions(input);
}

// ─── recordSuggestionFeedback ───────────────────────────────────────────

export async function recordSuggestionFeedback(
  input: RecordFeedbackInput,
): Promise<{ ok: true }> {
  const parsed = recordFeedbackSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid feedback payload.",
    );
  }
  const data = parsed.data;

  // Auth first; we'll bind membership to the log's circle once we know it.
  const userId = await requireUserId();

  const log = await db.query.suggestionLogs.findFirst({
    columns: { id: true, circleId: true, userId: true, planId: true },
    where: eq(suggestionLogs.id, data.suggestionLogId),
  });
  if (!log) {
    throw new ActionError("NOT_FOUND", "Suggestion log not found.");
  }

  // The drawer is single-user (05-api-contracts.md §Realtime); only the
  // requester who saw the suggestion should be able to record feedback on
  // it. Avoids one circle member overwriting another's add/reject.
  if (log.userId !== userId) {
    throw new ActionError("FORBIDDEN", "Not your suggestion.");
  }

  // Membership re-check protects the case where the user left the circle
  // between viewing the drawer and tapping feedback.
  await requireMembership(log.circleId);

  // 10-edge-cases.md §Race conditions: "Latest feedback wins". We just
  // overwrite — the item's feedbackAt reflects most recent tap.
  const updated = await db
    .update(suggestionLogItems)
    .set({ feedback: data.feedback, feedbackAt: new Date() })
    .where(
      and(
        eq(suggestionLogItems.id, data.itemId),
        eq(suggestionLogItems.logId, log.id),
      ),
    )
    .returning({ id: suggestionLogItems.id });

  if (updated.length === 0) {
    throw new ActionError("NOT_FOUND", "Suggestion item not found.");
  }

  // S7 — close the loop on the receipt timeline. `add` / `reject` only:
  // `refresh` is bulk telemetry (Flow H) and would pollute the activity log.
  // Emission is gated on the log already being plan-linked; the drawer's
  // pre-plan flow keeps planId null and silently skips, matching the
  // "when applicable" wording in implementation-plan.md S5.
  if (
    log.planId &&
    (data.feedback === "add" || data.feedback === "reject")
  ) {
    void recordPlanEvent({
      planId: log.planId,
      userId,
      kind: data.feedback === "add" ? "suggestion_added" : "suggestion_rejected",
      payload: { suggestionLogId: log.id, itemId: data.itemId },
    });
  }

  return { ok: true };
}

// ─── Internals ──────────────────────────────────────────────────────────

async function loadExistingLog(
  userId: string,
  requestNonce: string,
): Promise<RecommendationResult | null> {
  const existing = await db.query.suggestionLogs.findFirst({
    columns: {
      id: true,
      context: true,
      generatedAt: true,
      degraded: true,
    },
    where: and(
      eq(suggestionLogs.userId, userId),
      eq(suggestionLogs.requestNonce, requestNonce),
    ),
    with: {
      items: {
        columns: {
          id: true,
          rank: true,
          activity: true,
          breakdown: true,
          score: true,
        },
      },
    },
  });
  if (!existing) return null;

  // Items in deterministic rank order so a replay is identical to the
  // original response shape.
  const items = [...existing.items].sort((a, b) => a.rank - b.rank);
  const ctxStored = existing.context as SuggestionContext;

  // Re-derive explanation/confidence from stored breakdown+activity.
  // Explanation is intentionally NOT persisted (09-data-model.md §indexes
  // budget) since the explain step is pure and cheap to replay.
  const results: RankedResult[] = items.map((row) => {
    const activity = row.activity as Activity;
    const breakdown = row.breakdown as ScoreBreakdown;
    const normalized = row.score / 1000;
    return {
      id: row.id,
      activity,
      score: normalized,
      breakdown,
      explanation: explain(activity, breakdown, ctxStored),
      confidence: confidenceLabel(normalized),
      provider: activity.provider,
    };
  });

  return {
    suggestionLogId: existing.id,
    generatedAt: existing.generatedAt.toISOString(),
    results,
    degraded:
      (existing.degraded as RecommendationResult["degraded"]) ?? undefined,
  };
}

async function resolveCircleCentroid(
  circleId: string,
): Promise<SuggestionContext["circleCentroid"] | undefined> {
  const circle = await db.query.circles.findFirst({
    columns: { homeLat: true, homeLng: true },
    where: eq(circles.id, circleId),
  });
  if (circle?.homeLat != null && circle?.homeLng != null) {
    return { lat: circle.homeLat, lng: circle.homeLng };
  }

  // Fallback: centroid of recent geocoded venues. This is a write-cheap
  // approximation — no caching, but the table is tiny per-circle. If this
  // becomes hot we'll cache on circles.home_lat/lng directly.
  // Centroid fallback: join plan_venues → plans so we only consider venues
  // attached to this circle's plans. One round trip; the table is small
  // per-circle so no extra index is needed.
  const venues = await db
    .select({ externalGeo: planVenues.externalGeo })
    .from(planVenues)
    .innerJoin(plans, eq(planVenues.planId, plans.id))
    .where(eq(plans.circleId, circleId))
    .limit(CENTROID_FALLBACK_VENUE_LIMIT);

  const points = venues
    .map((v) => v.externalGeo as { lat?: number; lng?: number } | null)
    .filter(
      (g): g is { lat: number; lng: number } =>
        !!g && typeof g.lat === "number" && typeof g.lng === "number",
    );

  if (points.length === 0) return undefined;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

async function filterToMembers(
  circleId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.circleId, circleId),
        inArray(memberships.userId, candidateIds),
      ),
    );
  const valid = new Set(rows.map((r) => r.userId));
  return candidateIds.filter((id) => valid.has(id));
}

function deriveOutcome(
  result: RecommendationResult,
  ctx: SuggestionContext,
): "served" | "refreshed" | "empty" | "errored" {
  if (result.results.length > 0) return "served";
  // No results: distinguish "providers failed entirely" from "nothing
  // matched the filters". The pipeline degrades providers into entries,
  // so a fully-degraded list means we have no upstream truth.
  const degradedCount = result.degraded?.length ?? 0;
  if (degradedCount > 0 && degradedCount >= ctx.categories.length) {
    return "errored";
  }
  return "empty";
}

async function persistLog(args: {
  ctx: SuggestionContext;
  result: RecommendationResult;
  weights: ReturnType<typeof loadWeights>;
  outcome: "served" | "refreshed" | "empty" | "errored";
}): Promise<void> {
  const { ctx, result, weights, outcome } = args;
  const scrubbed = scrubContext(ctx);

  await db.transaction(async (tx) => {
    await tx.insert(suggestionLogs).values({
      id: result.suggestionLogId,
      circleId: ctx.circleId,
      userId: ctx.userId,
      requestNonce: ctx.requestNonce,
      context: scrubbed,
      weights,
      degraded: result.degraded ?? null,
      outcome,
      generatedAt: new Date(result.generatedAt),
    });

    if (result.results.length === 0) return;

    await tx.insert(suggestionLogItems).values(
      result.results.map((r, i) => ({
        id: r.id,
        logId: result.suggestionLogId,
        rank: i + 1,
        activity: r.activity,
        breakdown: r.breakdown,
        // Stored ×1000 (09-data-model.md) so the column stays int-indexable.
        score: Math.round(r.score * 1000),
      })),
    );
  });
}

// S9 — opportunistic weather fetch. The pipeline tolerates `weather:
// undefined` (score.ts §weatherScore falls to neutral defaults), so every
// failure mode here returns `{ weather: null }` and the caller adds a
// `weather_unavailable` entry to degraded[]. Reasons mirror provider-side
// errors so the admin dashboard can attribute outages.
async function fetchWeather(ctx: SuggestionContext): Promise<{
  weather: WeatherSnapshot | null;
  weatherDegraded: { provider: string; reason: string } | null;
}> {
  const provider = getWeatherProvider();
  if (!provider) {
    // No provider registered → not actually "down", just absent. Skip the
    // degraded entry so we don't pollute the admin Suggestions tab in
    // dev/no-key environments.
    return { weather: null, weatherDegraded: null };
  }
  const anchor = effectiveCentroid(ctx);
  if (!anchor) {
    // No anchor point means we'd be guessing — no degraded entry either.
    return { weather: null, weatherDegraded: null };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEATHER_HARD_TIMEOUT_MS);
  try {
    const snapshot = await provider.forecast(anchor, ctx.timeWindow, ac.signal);
    return {
      weather: snapshot,
      weatherDegraded: snapshot
        ? null
        : { provider: provider.name, reason: "weather_unavailable" },
    };
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.message === "BreakerOpen"
          ? "breaker_open"
          : err.message === "DailyCapExceeded"
            ? "daily_cap_exceeded"
            : err.name === "AbortError"
              ? "timeout"
              : "weather_unavailable"
        : "weather_unavailable";
    return {
      weather: null,
      weatherDegraded: { provider: provider.name, reason },
    };
  } finally {
    clearTimeout(timer);
  }
}

function scrubContext(ctx: SuggestionContext): SuggestionContext {
  // Quantize device + circle geo so the log row alone can't fingerprint
  // a household. The pipeline's in-memory copy is untouched.
  const q = (n: number): number =>
    Number(n.toFixed(GEO_QUANTIZE_DECIMALS));
  return {
    ...ctx,
    geo: ctx.geo
      ? {
          lat: q(ctx.geo.lat),
          lng: q(ctx.geo.lng),
          // Drop accuracy — also potentially identifying.
        }
      : undefined,
    circleCentroid: ctx.circleCentroid
      ? { lat: q(ctx.circleCentroid.lat), lng: q(ctx.circleCentroid.lng) }
      : undefined,
  };
}

