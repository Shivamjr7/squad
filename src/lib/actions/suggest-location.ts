"use server";

// Suggest Plan — location resolution helpers for the drawer's three-mode
// anchor chooser (Pass 2 of the ranking-quality work):
//   - "📍 Here"  → device geolocation (handled client-side, no action)
//   - "🏠 Home"  → circles.home_lat/lng (getCircleHome below)
//   - "📌 Other" → free-text query, geocoded via Places searchText
//
// Both actions require circle membership. We never expose
// GOOGLE_PLACES_API_KEY to the browser; the geocode round-trip happens
// here. Results are cached in `provider_cache` so re-typing "Indiranagar"
// is free for 24h.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { circles, providerCache } from "@/db/schema";
import { ActionError } from "@/lib/actions/errors";
import { requireMembership } from "@/lib/auth";

const QUERY_MIN_LEN = 2;
const QUERY_MAX_LEN = 120;
// 24h is generous for a place name; a venue's coords don't move and
// re-geocoding "Indiranagar Bangalore" hourly is wasted spend. Provider
// cache TTL handling is governed by the same vacuum-provider-cache cron
// added in S9.
const GEOCODE_TTL_MS = 24 * 60 * 60_000;
const GEOCODE_PROVIDER_NAME = "google_places_geocode";
const GEOCODE_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
].join(",");
// Tight bound — the user is waiting on this synchronously. Soft timeout
// only; AbortController kills the fetch.
const GEOCODE_TIMEOUT_MS = 2_500;

// ─── getCircleHome ──────────────────────────────────────────────────────

export type CircleHome = {
  lat: number;
  lng: number;
  label: string | null;
} | null;

const getCircleHomeSchema = z.object({
  circleId: z.string().uuid(),
});

export async function getCircleHome(input: {
  circleId: string;
}): Promise<CircleHome> {
  const parsed = getCircleHomeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError("INVALID", "Bad circleId.");
  }
  await requireMembership(parsed.data.circleId);

  const row = await db.query.circles.findFirst({
    columns: { homeLat: true, homeLng: true, homeLocationText: true },
    where: eq(circles.id, parsed.data.circleId),
  });
  if (!row || row.homeLat == null || row.homeLng == null) return null;
  return {
    lat: row.homeLat,
    lng: row.homeLng,
    label: row.homeLocationText,
  };
}

// ─── geocodeLocation ────────────────────────────────────────────────────

export type GeocodeResult = {
  lat: number;
  lng: number;
  /** Place's display name (e.g. "Indiranagar"). */
  label: string;
  /** Formatted address from Google. Optional — falls back to label. */
  address?: string;
};

const geocodeLocationSchema = z.object({
  circleId: z.string().uuid(),
  query: z
    .string()
    .trim()
    .min(QUERY_MIN_LEN, "Type at least 2 characters.")
    .max(QUERY_MAX_LEN, "Keep it under 120 characters."),
});

const responseSchema = z.object({
  places: z
    .array(
      z.object({
        displayName: z.object({ text: z.string().min(1) }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({
          latitude: z.number(),
          longitude: z.number(),
        }),
      }),
    )
    .optional()
    .default([]),
});

export async function geocodeLocation(input: {
  circleId: string;
  query: string;
}): Promise<GeocodeResult> {
  const parsed = geocodeLocationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Bad query.",
    );
  }
  // Membership gate so this isn't an open geocoding API for the world.
  await requireMembership(parsed.data.circleId);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("Location search isn't available — provider key missing.");
  }

  // 1. Cache lookup — keyed on a normalized query so "indiranagar  " and
  //    "Indiranagar" share an entry.
  const normalizedQuery = parsed.data.query.toLowerCase().replace(/\s+/g, " ").trim();
  const cacheKey = crypto
    .createHash("sha256")
    .update(GEOCODE_PROVIDER_NAME + ":" + normalizedQuery)
    .digest("hex");

  const cached = await readGeocodeCache(cacheKey);
  if (cached) return cached;

  // 2. Live call.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEOCODE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GEOCODE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: parsed.data.query,
        maxResultCount: 1,
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Location search timed out.");
    }
    throw new Error("Couldn't reach the location service.");
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error("Location search failed.");
  }

  const json: unknown = await response.json();
  const validated = responseSchema.safeParse(json);
  if (!validated.success || validated.data.places.length === 0) {
    throw new ActionError("NOT_FOUND", "No matching place. Try a wider query.");
  }
  const place = validated.data.places[0];

  const result: GeocodeResult = {
    lat: place.location.latitude,
    lng: place.location.longitude,
    label: place.displayName?.text ?? parsed.data.query,
    address: place.formattedAddress,
  };

  // 3. Store. Best-effort — geocode is idempotent, a failed write just
  //    means the next call refetches.
  void writeGeocodeCache(cacheKey, result);

  return result;
}

// ─── Internals ──────────────────────────────────────────────────────────

async function readGeocodeCache(key: string): Promise<GeocodeResult | null> {
  try {
    const rows = await db
      .select()
      .from(providerCache)
      .where(
        and(
          eq(providerCache.key, key),
          eq(providerCache.provider, GEOCODE_PROVIDER_NAME),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    const value = row.value as Partial<GeocodeResult> | null;
    if (
      !value ||
      typeof value.lat !== "number" ||
      typeof value.lng !== "number" ||
      typeof value.label !== "string"
    ) {
      return null;
    }
    return {
      lat: value.lat,
      lng: value.lng,
      label: value.label,
      address: typeof value.address === "string" ? value.address : undefined,
    };
  } catch {
    return null;
  }
}

async function writeGeocodeCache(
  key: string,
  result: GeocodeResult,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + GEOCODE_TTL_MS);
    await db
      .insert(providerCache)
      .values({
        key,
        provider: GEOCODE_PROVIDER_NAME,
        value: result,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: providerCache.key,
        set: { value: result, expiresAt, provider: GEOCODE_PROVIDER_NAME },
      });
  } catch {
    // Cache miss on next call; not load-bearing.
  }
}
