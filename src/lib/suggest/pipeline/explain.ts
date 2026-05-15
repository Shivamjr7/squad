// Stage 7 — explain. One-line, user-facing string per ranked result.
// Template-based and deterministic (same inputs → same string).
//
// S10 — Strategy seam. The call site (pipeline/index.ts and the action
// layer's loadExistingLog) now goes through `runExplainStrategy()` instead
// of calling the template directly. The default `templateExplanationStrategy`
// preserves the v1 behavior exactly; a v2 LLM-backed strategy registers
// itself the same way the providers do and overrides the default.
//
// Why the indirection: both `explain` and `rank` are single-call sites
// today, but if either grows a second caller the swap surface multiplies.
// Locking the seam now keeps the v2 AI plan to "register a new strategy"
// — no edits to the orchestrator, no edits to the action layer.

import type {
  Activity,
  ActivityCategory,
  ScoreBreakdown,
  SuggestionContext,
} from "@/lib/suggest/types";

// ─── Strategy interface + registry ──────────────────────────────────────

export interface ExplanationStrategy {
  readonly name: string;
  /**
   * Returns the one-line user-facing explanation. Allowed to return a
   * Promise so an LLM-backed implementation can await an API call — the
   * pipeline always awaits the result. The default template strategy is
   * synchronous and returns a plain string.
   */
  generate(
    activity: Activity,
    breakdown: ScoreBreakdown,
    ctx: SuggestionContext,
  ): string | Promise<string>;
}

let activeStrategy: ExplanationStrategy | null = null;

export function registerExplanationStrategy(strategy: ExplanationStrategy): void {
  activeStrategy = strategy;
}

export function getExplanationStrategy(): ExplanationStrategy {
  return activeStrategy ?? templateExplanationStrategy;
}

/** Test-only override; throws outside NODE_ENV=test. */
export function setExplanationStrategy(
  strategy: ExplanationStrategy | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setExplanationStrategy() is test-only.");
  }
  activeStrategy = strategy;
}

/**
 * Pipeline-facing facade. Awaits the active strategy so both sync (template)
 * and async (LLM) implementations route through the same call site.
 */
export async function runExplainStrategy(
  activity: Activity,
  breakdown: ScoreBreakdown,
  ctx: SuggestionContext,
): Promise<string> {
  return getExplanationStrategy().generate(activity, breakdown, ctx);
}

type ComponentKey = Exclude<keyof ScoreBreakdown, "raw">;

const COMPONENT_KEYS: ComponentKey[] = [
  "distance",
  "preference",
  "weather",
  "recency",
  "budget",
  "hours",
  "popularity",
];

const CATEGORY_NOUN: Record<ActivityCategory, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  movie: "Movie",
  event: "Event",
  indoor: "Indoor spot",
  outdoor: "Outdoor pick",
  short_trip: "Day trip",
};

/**
 * Default template-driven explanation. Synchronous, deterministic, no I/O.
 * Exported for direct unit-testing — the pipeline calls
 * `runExplainStrategy()` instead so a registered alternate (LLM, etc.) can
 * intercept.
 */
export function explain(
  activity: Activity,
  breakdown: ScoreBreakdown,
  ctx: SuggestionContext,
): string {
  const top = topComponent(breakdown);
  const noun = CATEGORY_NOUN[activity.category];
  const parts: string[] = [noun];

  switch (top) {
    case "distance": {
      const walk = walkingTimeLabel(activity.distanceMeters);
      if (walk) parts.push(walk);
      const open = openTillLabel(activity);
      if (open) parts.push(open);
      break;
    }
    case "preference": {
      const tag = (activity.tags ?? []).find(
        (t) => t in ctx.groupPreferences.cuisineAffinity,
      );
      parts.push(tag ? `squad likes ${humanizeTag(tag)}` : "matches squad taste");
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
    case "weather": {
      if (activity.weatherSensitivity === "indoor") {
        parts[0] = "Indoor pick";
        if (ctx.weather && breakdown.weather >= 0.9) {
          parts.push("feels rough out");
        }
      } else if (activity.weatherSensitivity === "outdoor") {
        parts.push("weather's right for it");
      }
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
    case "recency": {
      parts.push("you haven't been in a while");
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
    case "budget": {
      if (activity.priceTier) parts.push(activity.priceTier);
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
    case "hours": {
      const open = openTillLabel(activity);
      if (open) parts.push(open);
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
    case "popularity": {
      if (activity.rating) {
        parts.push(`${activity.rating.score.toFixed(1)} ★`);
      }
      const dist = distanceLabel(activity.distanceMeters);
      if (dist) parts.push(dist);
      break;
    }
  }

  return parts.join(" • ");
}

// ─── Helpers ────────────────────────────────────────────────────────────

function topComponent(b: ScoreBreakdown): ComponentKey {
  let key: ComponentKey = "distance";
  let max = b.distance;
  for (const k of COMPONENT_KEYS) {
    if (b[k] > max) {
      max = b[k];
      key = k;
    }
  }
  return key;
}

function walkingTimeLabel(meters: number | undefined): string | null {
  if (meters === undefined) return null;
  // ~80 m/min, the eternal walking-pace estimate.
  const minutes = Math.round(meters / 80);
  if (minutes <= 0) return "right next door";
  if (minutes <= 30) return `${minutes} min walk`;
  return distanceLabel(meters);
}

function distanceLabel(meters: number | undefined): string | null {
  if (meters === undefined) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function openTillLabel(activity: Activity): string | null {
  if (!activity.openingHours) return null;
  // ISO weekday for "today" in UTC. We don't shift to the venue's TZ — same
  // simplification as hours.ts and acceptable at the friend-group scope.
  const isoToday = ((new Date().getUTCDay() + 6) % 7) + 1;
  const brackets = activity.openingHours.weekly[isoToday];
  if (!brackets || brackets.length === 0) return null;
  const lastClose = brackets[brackets.length - 1].close;
  return `open till ${lastClose}`;
}

function humanizeTag(tag: string): string {
  return tag.replace(/_/g, " ");
}

// ─── Default strategy registration ──────────────────────────────────────

/**
 * Built-in template strategy. Registered eagerly at module load so the
 * pipeline has a working default even if no one ever calls
 * `registerExplanationStrategy()`. A v2 LLM strategy can override by
 * calling `registerExplanationStrategy(llmStrategy)` at app boot.
 */
export const templateExplanationStrategy: ExplanationStrategy = {
  name: "template",
  generate: explain,
};

registerExplanationStrategy(templateExplanationStrategy);
