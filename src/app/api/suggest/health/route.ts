import { gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { providerCache } from "@/db/schema";
import "@/lib/suggest/providers";
import { ACTIVITY_CATEGORIES } from "@/lib/suggest/types";
import type {
  ActivityCategory,
  ProviderHealth,
  SuggestionProvider,
} from "@/lib/suggest/types";
import { getProvider } from "@/lib/suggest/providers/registry";
import { getWeatherProvider } from "@/lib/suggest/providers/weather-registry";

// S9 — Suggest Plan health probe. Admin-only via the same Bearer-token
// pattern used by /api/cron/*. Returns:
//   {
//     providers: { google_places: 'ok', openweather: 'ok', tmdb: 'absent' },
//     cache_size_rows: 1234,
//     active_cache_rows: 980,
//     timestamp: '2026-…'
//   }
//
// Probes each provider's optional health?() — a missing provider becomes
// 'absent' (different from 'down': absent means no key/no registration,
// down means breaker open).
//
// Spec: docs/specs/suggest-plan/11-observability.md §Health checks.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProbeStatus = ProviderHealth | "absent";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === secret;
}

async function probe(provider: SuggestionProvider): Promise<ProbeStatus> {
  if (!provider.health) return "ok";
  try {
    return await provider.health();
  } catch {
    return "down";
  }
}

async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Collect unique providers across all activity categories.
  const seen = new Map<string, SuggestionProvider>();
  const categoryStatus: Partial<Record<ActivityCategory, string>> = {};
  for (const cat of ACTIVITY_CATEGORIES) {
    const provider = getProvider(cat);
    if (!provider) {
      categoryStatus[cat] = "absent";
      continue;
    }
    if (!seen.has(provider.name)) seen.set(provider.name, provider);
    categoryStatus[cat] = provider.name;
  }

  const providers: Record<string, ProbeStatus> = {};
  for (const [name, provider] of seen) {
    providers[name] = await probe(provider);
  }

  // Weather is a separate registry.
  const weather = getWeatherProvider();
  if (weather) {
    providers[weather.name] = weather.health
      ? await weather.health().catch(() => "down" as const)
      : "ok";
  }

  // Cache stats — single round trip. `expires_idx` makes the partial
  // index scan cheap. Total uses COUNT(*) which sequentially scans, but
  // the table is small (TTL-bounded).
  const now = new Date();
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerCache);
  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerCache)
    .where(gte(providerCache.expiresAt, now));

  return Response.json({
    providers,
    categoryStatus,
    cache_size_rows: totalRow?.count ?? 0,
    active_cache_rows: activeRow?.count ?? 0,
    timestamp: now.toISOString(),
  });
}

export { GET };
