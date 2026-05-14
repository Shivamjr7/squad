// Cross-provider normalization. Providers each return their own normalized
// Activity[]; this stage handles things that depend on the full result set
// (distance recompute against the centroid, dedup across providers) so each
// provider stays single-source-of-truth-naive.

import type { Activity, SuggestionContext } from "@/lib/suggest/types";

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Haversine great-circle distance in meters. Sufficient for the ≤50 km
 * radii we use; loses sub-meter precision near the poles, which we do not
 * care about.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Resolve the centroid the pipeline should anchor against. Per spec edge
 * G-edge-1, low-accuracy geo (> 1km) is ignored and we fall through to the
 * circle's home centroid. Null = no centroid → distance filter skipped,
 * distance score neutral.
 */
export function effectiveCentroid(
  ctx: SuggestionContext,
): { lat: number; lng: number } | null {
  if (ctx.geo) {
    const lowAccuracy =
      ctx.geo.accuracyMeters !== undefined && ctx.geo.accuracyMeters > 1000;
    if (!lowAccuracy) {
      return { lat: ctx.geo.lat, lng: ctx.geo.lng };
    }
  }
  if (ctx.circleCentroid) return ctx.circleCentroid;
  return null;
}

/**
 * Post-fetch normalization:
 *   1. Fill in `distanceMeters` if the provider didn't.
 *   2. Drop exact id dupes (a provider quirk or excludeId race).
 *   3. Drop fuzzy near-dupes: same name within 50 m.
 */
export function normalize(
  activities: Activity[],
  ctx: SuggestionContext,
): Activity[] {
  const centroid = effectiveCentroid(ctx);

  // 1. Distance compute.
  const distanced: Activity[] = activities.map((a) => {
    if (a.distanceMeters !== undefined) return a;
    if (!a.geo || !centroid) return a;
    return { ...a, distanceMeters: haversineMeters(centroid, a.geo) };
  });

  // 2. Exact id dedup (stable: first occurrence wins).
  const seenIds = new Set<string>();
  const byId: Activity[] = [];
  for (const a of distanced) {
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    byId.push(a);
  }

  // 3. Fuzzy dedup (same name + within 50 m). O(n²) but n is bounded.
  const out: Activity[] = [];
  for (const a of byId) {
    const isDup = out.some((b) => {
      if (a.name.toLowerCase() !== b.name.toLowerCase()) return false;
      if (!a.geo || !b.geo) return false;
      return haversineMeters(a.geo, b.geo) < 50;
    });
    if (!isDup) out.push(a);
  }

  return out;
}
