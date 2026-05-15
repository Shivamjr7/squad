# 04 — Domain Model

All types in `src/lib/suggest/types.ts`. TS strict + zod schemas live in `src/lib/validation/suggest.ts`. Drizzle table definitions are in `09-data-model.md`.

## `Activity`
Normalized, provider-agnostic. The shape every provider must produce.
```ts
type ActivityCategory =
  | 'restaurant' | 'cafe' | 'movie' | 'event'
  | 'indoor' | 'outdoor' | 'short_trip';

type Activity = {
  /** Provider-stable opaque id, prefixed: 'gp:ChIJ…', 'tmdb:550', 'evb:123' */
  id: string;
  provider: string;                          // 'google_places' | 'tmdb' | …
  category: ActivityCategory;
  name: string;
  description?: string;
  url?: string;                              // canonical link
  geo?: { lat: number; lng: number };
  address?: string;
  distanceMeters?: number;                   // computed in pipeline, not provider
  priceTier?: '$' | '$$' | '$$$' | '$$$$';
  rating?: { score: number; count: number };  // optional, normalized 0..5
  openingHours?: OpeningHours;               // see below
  imageUrl?: string;
  tags?: string[];                           // free-form, used by ranker
  // Lazy fields, filled only if cheap:
  weatherSensitivity?: 'indoor' | 'outdoor' | 'either';
  family?: {                                 // movie/event extras
    showtimes?: string[];                    // ISO
    venue?: string;
  };
};

type OpeningHours = {
  /** ISO weekday (1=Mon..7=Sun) → array of {open,close} in 'HH:mm' local */
  weekly: Record<number, Array<{ open: string; close: string }>>;
  timeZone: string;
};
```

## `SuggestionContext`
The full input to the pipeline.
```ts
type SuggestionContext = {
  circleId: string;
  userId: string;                            // requester
  planType: 'eat'|'play'|'chai'|'stay-in'|'other';
  categories: ActivityCategory[];            // resolved
  timeWindow: {
    startsAtUtc: string;                     // ISO
    endsAtUtc: string;                       // ISO
    isApproximate: boolean;
    timeZone: string;
  };
  geo?: { lat: number; lng: number; accuracyMeters?: number };
  circleCentroid?: { lat: number; lng: number };
  distanceKmCap: number;
  budgetTier?: '$' | '$$' | '$$$';
  excludeIds: string[];
  recipientUserIds: string[];                // [] = whole circle
  weather?: WeatherSnapshot;
  groupPreferences: GroupPreferenceProfile;
  // Carries through for log + dedupe / refresh
  requestNonce: string;                      // uuid, client-generated
};

type WeatherSnapshot = {
  // Aggregated across the timeWindow at the centroid
  conditions: 'clear'|'cloudy'|'rain'|'storm'|'snow'|'hot'|'cold'|'mild';
  tempC: number;
  precipitationMm: number;
  source: string;
  fetchedAt: string;                         // ISO
};
```

## `GroupPreferenceProfile`
A reduced, denormalized view of circle taste. Computed on demand (cached 15 min in memory) from `circle_preference_signals` + recent `plan_venues` + `votes`. Cheap to recompute; never the bottleneck.
```ts
type GroupPreferenceProfile = {
  circleId: string;
  /** subset of recipientUserIds the aggregation considered */
  cohort: string[];
  // Soft signals — each ∈ [-1, 1], 0 = neutral
  cuisineAffinity: Record<string, number>;   // 'south_indian', 'pizza', …
  categoryAffinity: Record<ActivityCategory, number>;
  priceAffinity: Record<'$'|'$$'|'$$$'|'$$$$', number>;
  // Anti-signal: venues / categories recently used
  recentVenueLabels: Array<{ label: string; lastUsedAt: string }>;
  // Optional, only populated if the circle has explicitly set them (v2 UI)
  hardExclusions?: string[];                 // e.g. ['nightclub']
  computedAt: string;                        // ISO
};
```

## `RecommendationResult` and `ScoreBreakdown`
```ts
type ScoreBreakdown = {
  distance: number;        // 0..1, closer = higher
  preference: number;      // 0..1
  weather: number;         // 0..1, 0.5 = neutral
  recency: number;         // 0..1, 1 = never used recently
  budget: number;          // 0..1
  hours: number;           // 0..1, 1 = open through window
  popularity: number;      // 0..1
  /** sum after weights, prior to normalization */
  raw: number;
};

type RankedResult = {
  id: string;              // suggestion_log_items.id
  activity: Activity;
  score: number;           // normalized 0..1
  breakdown: ScoreBreakdown;
  explanation: string;     // one-line, generated server-side
  confidence: 'high'|'medium'|'low';
  provider: string;
};

type RecommendationResult = {
  suggestionLogId: string;
  generatedAt: string;
  results: RankedResult[];
  degraded?: Array<{ provider: string; reason: string }>;
};
```

## Provider abstractions
```ts
interface SuggestionProvider {
  /** Stable identifier — used in logs and Activity.id prefixes */
  readonly name: string;
  /** Categories this provider can produce */
  readonly categories: ActivityCategory[];
  /** Returns up to `limit` normalized Activities. Must respect `signal`. */
  search(input: ProviderSearchInput, signal: AbortSignal): Promise<Activity[]>;
  /** Optional health check used by the breaker */
  health?(): Promise<'ok'|'degraded'|'down'>;
}

type ProviderSearchInput = {
  categories: ActivityCategory[];
  centroid: { lat: number; lng: number };
  radiusMeters: number;
  timeWindow: SuggestionContext['timeWindow'];
  budgetTier?: SuggestionContext['budgetTier'];
  excludeIds?: string[];
  limit: number;            // soft cap, provider may return fewer
};

interface WeatherProvider {
  readonly name: string;
  forecast(at: { lat: number; lng: number },
           timeWindow: SuggestionContext['timeWindow'],
           signal: AbortSignal): Promise<WeatherSnapshot | null>;
}
```

## Feedback events
```ts
type SuggestionFeedback =
  | 'add'        // user added the suggestion to plan_venues
  | 'reject'     // explicit ✕ tap
  | 'refresh'    // surfaced then refreshed away
  | 'won'        // plan locked with this venue winning (set by auto-lock)
  | 'cancelled'; // plan cancelled while this venue attached
```
