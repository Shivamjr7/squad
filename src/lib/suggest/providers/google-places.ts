// Suggest Plan — Google Places (New) v1 provider. First real provider
// implementation; everything in S9 (TMDB / Eventbrite / OpenWeather) mirrors
// this shape.
//
// Endpoint: POST https://places.googleapis.com/v1/places:searchNearby
//   Headers:
//     - X-Goog-Api-Key:  the API key
//     - X-Goog-FieldMask: the subset of place fields we want — explicit field
//       selection is cost-controlled by Google. We ask for exactly what
//       Activity needs and nothing more.
//
// Self-registers into the registry on import IF GOOGLE_PLACES_API_KEY is set.
// No key → readiness=degraded log + no registration → pipeline records
// `degraded[].reason = 'no_provider'` for any category that needed us.
//
// Failure isolation:
//   - 1.5s soft timeout via the caller's AbortSignal + our own race.
//   - In-process circuit breaker (3 failures / 60s → open for 30s).
//   - Daily call cap from env (default 5000) — once exceeded, treated as
//     breaker-open until UTC midnight.
//   - All external responses zod-parsed; malformed → throw → breaker trip.

import { z } from "zod";
import type {
  Activity,
  ActivityCategory,
  PriceTier,
  ProviderSearchInput,
  SuggestionProvider,
  WeatherSensitivity,
  OpeningHours,
} from "@/lib/suggest/types";
import { registerProvider } from "./registry";

// ─── Env + readiness ────────────────────────────────────────────────────

const PROVIDER_NAME = "google_places";
const API_URL = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.websiteUri",
].join(",");

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
const dailyCap = Number.parseInt(
  process.env.SUGGEST_GOOGLE_PLACES_DAILY_CAP ?? "5000",
  10,
);

const SOFT_TIMEOUT_MS = 1_500;
const SUPPORTED_CATEGORIES: ActivityCategory[] = [
  "restaurant",
  "cafe",
  "indoor",
  "outdoor",
  "short_trip",
];

// ─── Category → Google place type mapping ───────────────────────────────

const CATEGORY_TO_TYPES: Record<ActivityCategory, string[]> = {
  restaurant: ["restaurant"],
  cafe: ["cafe"],
  indoor: ["museum", "art_gallery", "bowling_alley", "shopping_mall"],
  outdoor: ["park"],
  short_trip: ["tourist_attraction"],
  // Categories this provider does not serve — left empty so the pipeline can
  // ask for any category without us having to filter upstream.
  movie: [],
  event: [],
};

const TYPE_PRIORITY: Array<{ type: string; category: ActivityCategory }> = [
  { type: "cafe", category: "cafe" },
  { type: "restaurant", category: "restaurant" },
  { type: "museum", category: "indoor" },
  { type: "art_gallery", category: "indoor" },
  { type: "bowling_alley", category: "indoor" },
  { type: "shopping_mall", category: "indoor" },
  { type: "park", category: "outdoor" },
  { type: "tourist_attraction", category: "short_trip" },
];

function categoryFromTypes(
  types: string[] | undefined,
  requested: ActivityCategory[],
): ActivityCategory | null {
  if (!types) return null;
  for (const { type, category } of TYPE_PRIORITY) {
    if (types.includes(type) && requested.includes(category)) return category;
  }
  return null;
}

function inferSensitivity(category: ActivityCategory): WeatherSensitivity {
  switch (category) {
    case "outdoor":
    case "short_trip":
      return "outdoor";
    case "indoor":
    case "movie":
      return "indoor";
    default:
      return "either";
  }
}

// ─── Response schema (defensive parsing) ────────────────────────────────

const priceLevelSchema = z
  .enum([
    "PRICE_LEVEL_UNSPECIFIED",
    "PRICE_LEVEL_FREE",
    "PRICE_LEVEL_INEXPENSIVE",
    "PRICE_LEVEL_MODERATE",
    "PRICE_LEVEL_EXPENSIVE",
    "PRICE_LEVEL_VERY_EXPENSIVE",
  ])
  .optional();

const openingPeriodSchema = z.object({
  open: z
    .object({
      day: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .optional(),
  close: z
    .object({
      day: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .optional(),
});

const placeSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string().min(1) }).optional(),
  formattedAddress: z.string().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
  types: z.array(z.string()).optional(),
  priceLevel: priceLevelSchema,
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  regularOpeningHours: z
    .object({
      periods: z.array(openingPeriodSchema).optional(),
    })
    .optional(),
  websiteUri: z.string().optional(),
});

type Place = z.infer<typeof placeSchema>;

const responseSchema = z.object({
  places: z.array(placeSchema).optional().default([]),
});

// ─── Normalization helpers ──────────────────────────────────────────────

function mapPriceLevel(level: Place["priceLevel"]): PriceTier | undefined {
  switch (level) {
    case "PRICE_LEVEL_FREE":
    case "PRICE_LEVEL_INEXPENSIVE":
      return "$";
    case "PRICE_LEVEL_MODERATE":
      return "$$";
    case "PRICE_LEVEL_EXPENSIVE":
      return "$$$";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "$$$$";
    default:
      return undefined;
  }
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

// Google's `day` field uses Sunday=0..Saturday=6. Activity.OpeningHours uses
// ISO weekday (Monday=1..Sunday=7). Convert here so the rest of the pipeline
// doesn't have to think about it.
function googleDayToIso(day: number): number {
  return day === 0 ? 7 : day;
}

function parseOpeningHours(
  raw: Place["regularOpeningHours"],
  timeZone: string,
): OpeningHours | undefined {
  if (!raw?.periods?.length) return undefined;
  const weekly: OpeningHours["weekly"] = {};
  for (const period of raw.periods) {
    if (!period.open) continue;
    const isoDay = googleDayToIso(period.open.day);
    const openStr = pad2(period.open.hour) + ":" + pad2(period.open.minute);
    const closeStr = period.close
      ? pad2(period.close.hour) + ":" + pad2(period.close.minute)
      : "23:59"; // open-until-midnight default
    if (!weekly[isoDay]) weekly[isoDay] = [];
    weekly[isoDay].push({ open: openStr, close: closeStr });
  }
  return { weekly, timeZone };
}

function normalizePlace(
  place: Place,
  requested: ActivityCategory[],
): Activity | null {
  const category = categoryFromTypes(place.types, requested);
  if (!category) return null;
  const geo = place.location
    ? { lat: place.location.latitude, lng: place.location.longitude }
    : undefined;
  const rating =
    place.rating !== undefined && place.userRatingCount !== undefined
      ? { score: place.rating, count: place.userRatingCount }
      : undefined;
  return {
    id: `gp:${place.id}`,
    provider: PROVIDER_NAME,
    category,
    name: place.displayName?.text ?? "(unnamed)",
    address: place.formattedAddress,
    geo,
    url: place.websiteUri,
    priceTier: mapPriceLevel(place.priceLevel),
    rating,
    openingHours: parseOpeningHours(
      place.regularOpeningHours,
      // Google returns periods in the place's local TZ but doesn't tell us
      // which TZ. We tag with the pipeline's request TZ via Activity-level
      // wiring later; for now mark as UTC and let normalize/filter handle.
      "UTC",
    ),
    tags: place.types,
    weatherSensitivity: inferSensitivity(category),
  };
}

// ─── Circuit breaker (module-private state) ─────────────────────────────

type BreakerState = "closed" | "open" | "half-open";

const breaker = {
  state: "closed" as BreakerState,
  failures: 0,
  openedAt: 0,
  // Per spec: 3 consecutive failures → open; cooldown 30s; half-open lets a
  // single canary request decide.
  threshold: 3,
  cooldownMs: 30_000,
};

function breakerCheck(): void {
  if (breaker.state !== "open") return;
  if (Date.now() - breaker.openedAt >= breaker.cooldownMs) {
    breaker.state = "half-open";
    return;
  }
  throw new Error("BreakerOpen");
}

function breakerRecordSuccess(): void {
  breaker.failures = 0;
  breaker.state = "closed";
}

function breakerRecordFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= breaker.threshold) {
    breaker.state = "open";
    breaker.openedAt = Date.now();
  }
}

// ─── Daily cap (module-private state) ───────────────────────────────────

const dailyCallCounter = {
  day: utcDay(new Date()),
  count: 0,
};

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dailyCapCheck(): void {
  const today = utcDay(new Date());
  if (dailyCallCounter.day !== today) {
    dailyCallCounter.day = today;
    dailyCallCounter.count = 0;
  }
  if (Number.isFinite(dailyCap) && dailyCallCounter.count >= dailyCap) {
    throw new Error("DailyCapExceeded");
  }
}

function dailyCapIncrement(): void {
  dailyCallCounter.count += 1;
}

// ─── Provider impl ──────────────────────────────────────────────────────

async function performSearch(
  input: ProviderSearchInput,
  signal: AbortSignal,
): Promise<Activity[]> {
  // Merge per-category Google types, dedupe.
  const includedTypes = Array.from(
    new Set(input.categories.flatMap((c) => CATEGORY_TO_TYPES[c] ?? [])),
  );
  if (includedTypes.length === 0) return [];

  const body = {
    includedTypes,
    maxResultCount: Math.min(20, Math.max(1, input.limit)),
    locationRestriction: {
      circle: {
        center: {
          latitude: input.centroid.lat,
          longitude: input.centroid.lng,
        },
        // Places API allows 1..50000 meters. Clamp defensively.
        radius: Math.min(50_000, Math.max(1, input.radiusMeters)),
      },
    },
  };

  // Race the caller's AbortSignal against our 1.5s soft timeout.
  const localAbort = new AbortController();
  const timeoutId = setTimeout(() => localAbort.abort(), SOFT_TIMEOUT_MS);
  const onUpstreamAbort = () => localAbort.abort();
  signal.addEventListener("abort", onUpstreamAbort);

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // apiKey is guaranteed non-null at this point — provider only
        // registers itself when the key is set, so the registry never
        // hands us out without it. Asserted in callers via the readiness
        // check, repeated here as a runtime guard.
        "X-Goog-Api-Key": apiKey ?? "",
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: localAbort.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onUpstreamAbort);
  }

  if (!response.ok) {
    // 4xx + 5xx alike: treat as breaker-trippable. Caller catches.
    throw new Error(`google_places HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("google_places response failed schema validation");
  }

  const out: Activity[] = [];
  const excluded = new Set(input.excludeIds ?? []);
  for (const place of parsed.data.places) {
    const activity = normalizePlace(place, input.categories);
    if (!activity) continue;
    if (excluded.has(activity.id)) continue;
    out.push(activity);
  }
  return out;
}

export const googlePlacesProvider: SuggestionProvider = {
  name: PROVIDER_NAME,
  categories: SUPPORTED_CATEGORIES,
  async search(input, signal) {
    breakerCheck();
    dailyCapCheck();
    try {
      dailyCapIncrement();
      const result = await performSearch(input, signal);
      breakerRecordSuccess();
      return result;
    } catch (err) {
      breakerRecordFailure();
      throw err;
    }
  },
  async health() {
    if (breaker.state === "open") return "down";
    if (breaker.state === "half-open" || breaker.failures > 0) return "degraded";
    return "ok";
  },
};

// ─── Self-registration ──────────────────────────────────────────────────

if (apiKey) {
  registerProvider(googlePlacesProvider);
} else {
  // Readiness log only — no throw. Pipeline records `no_provider` for any
  // category that would have routed here.
  console.warn(
    "[suggest:google_places] readiness=degraded reason=missing_api_key",
  );
}

// Exported for unit testing and observability only — not part of the
// SuggestionProvider contract.
export const __internals = {
  CATEGORY_TO_TYPES,
  categoryFromTypes,
  mapPriceLevel,
  parseOpeningHours,
  normalizePlace,
  responseSchema,
  breaker,
  dailyCallCounter,
};
