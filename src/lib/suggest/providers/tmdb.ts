// Suggest Plan — TMDB movie SuggestionProvider (S9). Optional v1 provider:
// missing TMDB_API_KEY → readiness log only, no registration.
//
// Endpoint: GET https://api.themoviedb.org/3/movie/now_playing
//   Params:
//     - api_key  = v3 API key (the simple flavor; v4 Bearer is also accepted
//                  but we don't ship that yet — keeps the env footprint to one
//                  variable)
//     - region   = derived from input.timeWindow.timeZone via a small ISO
//                  3166-1 lookup. TMDB filters by country availability so an
//                  unknown TZ → no region filter (still works, slightly less
//                  relevant).
//     - page     = 1
//
// TMDB has no concept of distance — the same release set serves every
// caller in a region. The pipeline still passes `centroid`/`radiusMeters`;
// we ignore them. Distance scoring degrades to the neutral 0.5 default in
// score.ts when an Activity has no `geo`, which is exactly what we want.

import { z } from "zod";
import type {
  Activity,
  ActivityCategory,
  ProviderSearchInput,
  SuggestionProvider,
  TimeWindow,
} from "@/lib/suggest/types";
import { registerProvider } from "./registry";

// ─── Env + readiness ────────────────────────────────────────────────────

const PROVIDER_NAME = "tmdb";
const API_URL = "https://api.themoviedb.org/3/movie/now_playing";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_DETAILS_BASE = "https://www.themoviedb.org/movie";
const SOFT_TIMEOUT_MS = 1_500;
const SUPPORTED_CATEGORIES: ActivityCategory[] = ["movie"];

const apiKey = process.env.TMDB_API_KEY;
const dailyCap = Number.parseInt(
  process.env.SUGGEST_TMDB_DAILY_CAP ?? "1000",
  10,
);

// IANA TZ → ISO 3166-1 alpha-2 country, narrowly scoped to the regions we
// actually care about for v1. Unknown → undefined, which TMDB tolerates.
const TZ_TO_REGION: Record<string, string> = {
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "America/New_York": "US",
  "America/Los_Angeles": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "Europe/London": "GB",
  "Europe/Berlin": "DE",
  "Europe/Paris": "FR",
  "Asia/Singapore": "SG",
  "Asia/Tokyo": "JP",
  "Australia/Sydney": "AU",
};

function regionFromTz(tw: TimeWindow): string | undefined {
  return TZ_TO_REGION[tw.timeZone];
}

// ─── Response schema ────────────────────────────────────────────────────

const movieSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  overview: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  release_date: z.string().optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().int().optional(),
  genre_ids: z.array(z.number().int()).optional(),
});

const responseSchema = z.object({
  results: z.array(movieSchema).optional().default([]),
});

type Movie = z.infer<typeof movieSchema>;

// ─── Normalization ──────────────────────────────────────────────────────

function normalizeMovie(movie: Movie): Activity {
  const rating =
    movie.vote_average !== undefined && movie.vote_count !== undefined
      ? {
          // TMDB rates 0..10; surface as 0..5 to match the rest of the UI
          // and the popularity score (which divides by 5 in score.ts).
          score: Math.round((movie.vote_average / 2) * 10) / 10,
          count: movie.vote_count,
        }
      : undefined;
  return {
    id: `tmdb:${movie.id}`,
    provider: PROVIDER_NAME,
    category: "movie",
    name: movie.title,
    description: movie.overview,
    url: `${TMDB_DETAILS_BASE}/${movie.id}`,
    imageUrl: movie.poster_path
      ? `${POSTER_BASE}${movie.poster_path}`
      : undefined,
    rating,
    weatherSensitivity: "indoor",
    // TMDB tags would require a second /genre/movie/list call to map ids →
    // names. Skip for v1; the preference-affinity scorer just won't find a
    // match and falls to neutral. v2 can hydrate genre names.
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
  if (!input.categories.includes("movie")) return [];

  const url = new URL(API_URL);
  url.searchParams.set("api_key", apiKey ?? "");
  url.searchParams.set("page", "1");
  const region = regionFromTz(input.timeWindow);
  if (region) url.searchParams.set("region", region);

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
    throw new Error(`tmdb HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("tmdb response failed schema validation");
  }

  const excluded = new Set(input.excludeIds ?? []);
  const out: Activity[] = [];
  for (const movie of parsed.data.results) {
    const activity = normalizeMovie(movie);
    if (excluded.has(activity.id)) continue;
    out.push(activity);
    if (out.length >= input.limit) break;
  }
  return out;
}

export const tmdbProvider: SuggestionProvider = {
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
  registerProvider(tmdbProvider);
} else {
  console.warn("[suggest:tmdb] readiness=degraded reason=missing_api_key");
}

export const __internals = {
  TZ_TO_REGION,
  regionFromTz,
  normalizeMovie,
  responseSchema,
  breaker,
  dailyCallCounter,
};
