// Suggest Plan — OpenWeather WeatherProvider (S9). Mirrors the hardening
// envelope of google-places.ts: 1.5s soft timeout, in-process circuit
// breaker, daily call cap, defensive zod parsing, self-registration gated
// on OPENWEATHER_API_KEY.
//
// Endpoint: GET https://api.openweathermap.org/data/2.5/forecast
//   Params:
//     - lat / lon
//     - appid     = API key
//     - units     = metric
//     - cnt       = 16 (8 days × 3-hour slots; we only walk forward to the
//                   window start, so 16 is a wide margin)
//
// Why /forecast and not /weather: the recommendation pipeline asks about a
// future TimeWindow, not "now". The 5-day / 3-hour forecast gives us the
// next slot covering startsAtUtc. Falls back to the nearest available slot
// when the window is outside coverage; if everything fails the provider
// returns null and the pipeline scores activities with neutral weather
// defaults (per score.ts §weatherScore).

import { z } from "zod";
import type {
  TimeWindow,
  WeatherConditions,
  WeatherProvider,
  WeatherSnapshot,
} from "@/lib/suggest/types";
import { registerWeatherProvider } from "./weather-registry";

// ─── Env + readiness ────────────────────────────────────────────────────

const PROVIDER_NAME = "openweather";
const API_URL = "https://api.openweathermap.org/data/2.5/forecast";
const SOFT_TIMEOUT_MS = 1_500;

const apiKey = process.env.OPENWEATHER_API_KEY;
const dailyCap = Number.parseInt(
  process.env.SUGGEST_OPENWEATHER_DAILY_CAP ?? "1000",
  10,
);

// ─── Response schema (only the fields we actually use) ──────────────────

const slotSchema = z.object({
  dt: z.number(),
  main: z.object({
    temp: z.number(),
  }),
  weather: z
    .array(
      z.object({
        main: z.string(),
        id: z.number().optional(),
      }),
    )
    .min(1),
  rain: z.object({ "3h": z.number().optional() }).optional(),
  snow: z.object({ "3h": z.number().optional() }).optional(),
});

const responseSchema = z.object({
  list: z.array(slotSchema).min(1),
});

type Slot = z.infer<typeof slotSchema>;

// ─── Normalization ──────────────────────────────────────────────────────

// OpenWeather "main" enum we care about. Anything unknown maps to "cloudy"
// as the safe middle — neither dries up the weather penalty nor inflates
// it. Per spec, only `clear|cloudy|rain|storm|snow|hot|cold|mild` are
// recognized downstream.
function mapMainToCondition(
  main: string,
  tempC: number,
): WeatherConditions {
  const m = main.toLowerCase();
  if (m === "thunderstorm") return "storm";
  if (m === "snow") return "snow";
  if (m === "rain" || m === "drizzle") return "rain";
  if (m === "clear") {
    if (tempC >= 30) return "hot";
    if (tempC <= 10) return "cold";
    return "clear";
  }
  if (m === "clouds") return "cloudy";
  // Atmospheric phenomena (fog, smoke, haze, …) treated as cloudy — they
  // don't trigger the outdoor penalty but aren't pristine either.
  return "cloudy";
}

function pickSlot(slots: Slot[], targetMs: number): Slot {
  // Slots come in chronological order. Find the first slot ≥ target; if
  // none, fall back to the last slot. Linear scan over ≤ 40 entries.
  for (const s of slots) {
    if (s.dt * 1000 >= targetMs) return s;
  }
  return slots[slots.length - 1];
}

function buildSnapshot(slot: Slot, fetchedAt: string): WeatherSnapshot {
  const tempC = slot.main.temp;
  const rain = slot.rain?.["3h"] ?? 0;
  const snow = slot.snow?.["3h"] ?? 0;
  const precipitationMm = rain + snow;
  const conditions = mapMainToCondition(slot.weather[0].main, tempC);
  return {
    conditions,
    tempC,
    precipitationMm,
    source: PROVIDER_NAME,
    fetchedAt,
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

async function performForecast(
  at: { lat: number; lng: number },
  timeWindow: TimeWindow,
  signal: AbortSignal,
): Promise<WeatherSnapshot | null> {
  const url = new URL(API_URL);
  url.searchParams.set("lat", at.lat.toFixed(4));
  url.searchParams.set("lon", at.lng.toFixed(4));
  url.searchParams.set("appid", apiKey ?? "");
  url.searchParams.set("units", "metric");
  url.searchParams.set("cnt", "16");

  // Race the caller's AbortSignal against our soft timeout — same pattern
  // as google-places so behavior is uniform across providers.
  const localAbort = new AbortController();
  const timeoutId = setTimeout(() => localAbort.abort(), SOFT_TIMEOUT_MS);
  const onUpstreamAbort = () => localAbort.abort();
  signal.addEventListener("abort", onUpstreamAbort);

  let response: Response;
  try {
    response = await fetch(url, { signal: localAbort.signal });
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onUpstreamAbort);
  }

  if (!response.ok) {
    throw new Error(`openweather HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("openweather response failed schema validation");
  }

  const target = new Date(timeWindow.startsAtUtc).getTime();
  const slot = pickSlot(parsed.data.list, target);
  return buildSnapshot(slot, new Date().toISOString());
}

export const openweatherProvider: WeatherProvider = {
  name: PROVIDER_NAME,
  async forecast(at, timeWindow, signal) {
    breakerCheck();
    dailyCapCheck();
    try {
      dailyCapIncrement();
      const result = await performForecast(at, timeWindow, signal);
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
  registerWeatherProvider(openweatherProvider);
} else {
  console.warn(
    "[suggest:openweather] readiness=degraded reason=missing_api_key",
  );
}

// Exported for unit testing / observability only.
export const __internals = {
  mapMainToCondition,
  pickSlot,
  buildSnapshot,
  breaker,
  dailyCallCounter,
  responseSchema,
};
