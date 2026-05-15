// Suggest Plan — Eventbrite event SuggestionProvider (S9). Optional v1
// provider: missing EVENTBRITE_API_KEY → readiness log only, no
// registration.
//
// Endpoint: GET https://www.eventbriteapi.com/v3/events/search/
//   Headers: Authorization: Bearer <token>
//   Params:
//     - location.latitude / longitude
//     - location.within  = "<km>km"
//     - start_date.range_start / range_end (ISO 8601 in UTC)
//     - sort_by = "date"
//     - expand  = "venue"   (so we can pull venue.address)
//
// Notes:
//   - Eventbrite's public search has had access changes over the years. If
//     the token in env cannot reach this endpoint we'll see 401/403 →
//     breaker trips → pipeline degrades → users see "events aren't loading
//     right now." Exactly the degraded-provider path we already test for
//     google-places.

import { z } from "zod";
import type {
  Activity,
  ActivityCategory,
  ProviderSearchInput,
  SuggestionProvider,
} from "@/lib/suggest/types";
import { registerProvider } from "./registry";

// ─── Env + readiness ────────────────────────────────────────────────────

const PROVIDER_NAME = "eventbrite";
const API_URL = "https://www.eventbriteapi.com/v3/events/search/";
const SOFT_TIMEOUT_MS = 1_500;
const SUPPORTED_CATEGORIES: ActivityCategory[] = ["event"];

const apiKey = process.env.EVENTBRITE_API_KEY;
const dailyCap = Number.parseInt(
  process.env.SUGGEST_EVENTBRITE_DAILY_CAP ?? "1000",
  10,
);

// ─── Response schema ────────────────────────────────────────────────────

const eventSchema = z.object({
  id: z.string().min(1),
  name: z
    .object({ text: z.string().nullable().optional() })
    .nullable()
    .optional(),
  description: z
    .object({ text: z.string().nullable().optional() })
    .nullable()
    .optional(),
  url: z.string().optional(),
  start: z.object({ utc: z.string().optional() }).optional(),
  end: z.object({ utc: z.string().optional() }).optional(),
  is_free: z.boolean().optional(),
  logo: z
    .object({ url: z.string().optional() })
    .nullable()
    .optional(),
  venue: z
    .object({
      name: z.string().optional(),
      address: z
        .object({ localized_address_display: z.string().optional() })
        .optional(),
      latitude: z.union([z.string(), z.number()]).optional(),
      longitude: z.union([z.string(), z.number()]).optional(),
    })
    .nullable()
    .optional(),
});

const responseSchema = z.object({
  events: z.array(eventSchema).optional().default([]),
});

type Event = z.infer<typeof eventSchema>;

// ─── Normalization ──────────────────────────────────────────────────────

function toNum(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : undefined;
}

function normalizeEvent(event: Event): Activity | null {
  const name = event.name?.text;
  if (!name) return null;

  const venue = event.venue ?? undefined;
  const lat = toNum(venue?.latitude);
  const lng = toNum(venue?.longitude);
  const geo = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

  const showtimes: string[] = [];
  if (event.start?.utc) showtimes.push(event.start.utc);

  return {
    id: `evb:${event.id}`,
    provider: PROVIDER_NAME,
    category: "event",
    name,
    description: event.description?.text ?? undefined,
    url: event.url,
    geo,
    address: venue?.address?.localized_address_display,
    imageUrl: event.logo?.url,
    priceTier: event.is_free ? "$" : undefined,
    weatherSensitivity: "either",
    family: showtimes.length
      ? { showtimes, venue: venue?.name }
      : undefined,
  };
}

// ─── Circuit breaker (module-private) ───────────────────────────────────

type BreakerState = "closed" | "open" | "half-open";

const breaker = {
  state: "closed" as BreakerState,
  failures: 0,
  openedAt: 0,
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

// ─── Daily cap (module-private) ─────────────────────────────────────────

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
  if (!input.categories.includes("event")) return [];

  const url = new URL(API_URL);
  url.searchParams.set("location.latitude", input.centroid.lat.toFixed(4));
  url.searchParams.set("location.longitude", input.centroid.lng.toFixed(4));
  // Eventbrite expects a "<n>km" string for radius.
  const km = Math.max(1, Math.min(100, Math.round(input.radiusMeters / 1000)));
  url.searchParams.set("location.within", `${km}km`);
  url.searchParams.set("start_date.range_start", input.timeWindow.startsAtUtc);
  url.searchParams.set("start_date.range_end", input.timeWindow.endsAtUtc);
  url.searchParams.set("sort_by", "date");
  url.searchParams.set("expand", "venue");

  const localAbort = new AbortController();
  const timeoutId = setTimeout(() => localAbort.abort(), SOFT_TIMEOUT_MS);
  const onUpstreamAbort = () => localAbort.abort();
  signal.addEventListener("abort", onUpstreamAbort);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey ?? ""}`,
      },
      signal: localAbort.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onUpstreamAbort);
  }

  if (!response.ok) {
    throw new Error(`eventbrite HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("eventbrite response failed schema validation");
  }

  const excluded = new Set(input.excludeIds ?? []);
  const out: Activity[] = [];
  for (const event of parsed.data.events) {
    const activity = normalizeEvent(event);
    if (!activity) continue;
    if (excluded.has(activity.id)) continue;
    out.push(activity);
    if (out.length >= input.limit) break;
  }
  return out;
}

export const eventbriteProvider: SuggestionProvider = {
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
  registerProvider(eventbriteProvider);
} else {
  console.warn(
    "[suggest:eventbrite] readiness=degraded reason=missing_api_key",
  );
}

export const __internals = {
  normalizeEvent,
  responseSchema,
  breaker,
  dailyCallCounter,
};
