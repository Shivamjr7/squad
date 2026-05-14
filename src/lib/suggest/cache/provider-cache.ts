// Suggest Plan — Postgres-backed provider cache + cacheThrough helper.
// See docs/specs/suggest-plan/08-provider-architecture.md.
//
// Two layers:
//   1. memoryLRU (5s, this process) — absorbs double-tap bursts.
//   2. provider_cache table (per-provider TTL) — shared across lambdas.
//
// Failure semantics: all DB errors are swallowed. The cache is a perf
// optimization, never a hard requirement. A failed lookup falls through to
// the provider; a failed write means the next request will refetch — both
// are acceptable. The pipeline (S4) sees no difference.

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { providerCache } from "@/db/schema";
import type {
  Activity,
  ProviderSearchInput,
  SuggestionProvider,
} from "@/lib/suggest/types";
import { MemoryLRU } from "./memory-lru";

// ─── Config ─────────────────────────────────────────────────────────────

const MEMORY_TTL_MS = 5_000;
const MEMORY_MAX_ENTRIES = 200;

// Per-provider Postgres TTL. Per spec: places 30 min, weather 15 min,
// movies/events 6 h. Weather goes through a separate cache key namespace
// so it's fine that this map is activity-only.
const PROVIDER_TTLS_MS: Record<string, number> = {
  google_places: 30 * 60_000,
  tmdb: 6 * 60 * 60_000,
  eventbrite: 6 * 60 * 60_000,
};
const DEFAULT_PROVIDER_TTL_MS = 30 * 60_000;

const memoryLRU = new MemoryLRU<Activity[]>({ max: MEMORY_MAX_ENTRIES });

// ─── Key derivation ─────────────────────────────────────────────────────

/**
 * Stable JSON serializer — sorts object keys recursively so cache keys are
 * deterministic regardless of insertion order. Faster than pulling in a dep
 * for this single use.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

function cacheKey(providerName: string, input: ProviderSearchInput): string {
  return crypto
    .createHash("sha256")
    .update(providerName + ":" + canonicalJson(input))
    .digest("hex");
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function cacheLookup(
  providerName: string,
  input: ProviderSearchInput,
): Promise<Activity[] | null> {
  const key = cacheKey(providerName, input);
  const fromMemory = memoryLRU.get(key);
  if (fromMemory) return fromMemory;

  try {
    const rows = await db
      .select()
      .from(providerCache)
      .where(eq(providerCache.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    // Trust the stored shape — it was normalized on write — but isolate via
    // try/catch above in case jsonb decodes unexpectedly.
    const value = row.value as Activity[];
    if (!Array.isArray(value)) return null;
    memoryLRU.set(key, value, MEMORY_TTL_MS);
    return value;
  } catch {
    // DB unreachable — degrade to no-cache.
    return null;
  }
}

export async function cacheStore(
  providerName: string,
  input: ProviderSearchInput,
  value: Activity[],
): Promise<void> {
  const key = cacheKey(providerName, input);
  const ttlMs = PROVIDER_TTLS_MS[providerName] ?? DEFAULT_PROVIDER_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);
  memoryLRU.set(key, value, MEMORY_TTL_MS);
  try {
    await db
      .insert(providerCache)
      .values({
        key,
        provider: providerName,
        value,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: providerCache.key,
        set: { value, expiresAt, provider: providerName },
      });
  } catch {
    // Write failed — memory cache still has it; next instance will refetch.
  }
}

/**
 * One-shot cache + fetch flow used by the pipeline (S4). Cache hit short-
 * circuits the provider; cache miss invokes `provider.search()` and stores
 * the result. Provider errors propagate to the caller — cache writes only
 * happen on success.
 */
export async function cacheThrough(
  provider: SuggestionProvider,
  input: ProviderSearchInput,
  signal: AbortSignal,
): Promise<Activity[]> {
  const cached = await cacheLookup(provider.name, input);
  if (cached) return cached;
  const fresh = await provider.search(input, signal);
  await cacheStore(provider.name, input, fresh);
  return fresh;
}

// Exported for tests / observability; not part of the public S3 API surface.
export const __internals = { canonicalJson, cacheKey, memoryLRU };
