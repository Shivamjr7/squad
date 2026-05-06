"use client";

import { useEffect, useState } from "react";

// M25 — "12 min walk" hint under the venue. Stays silent unless geolocation
// is granted AND the venue resolves to a coordinate within walking range.
// Geocoding goes through Nominatim (public, no API key) and the result is
// cached per-session so we don't re-geocode on every render. Walking speed
// is fixed at 5 km/h; anything past 5 km is hidden — at that point "walk"
// stops being honest and we'd rather render nothing than mislead.

const WALKING_KMH = 5;
const MAX_WALK_KM = 5;
const EARTH_KM = 6371;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_KM * c;
}

export function WalkingTimeHint({
  location,
  className,
}: {
  location: string | null;
  className?: string;
}) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!location) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const cacheKey = `squad:walk:${location}`;
    const cached =
      typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem(cacheKey)
        : null;
    if (cached === "skip") return;
    if (cached?.startsWith("min:")) {
      setLabel(`${cached.slice(4)} min walk`);
      return;
    }

    let cancelled = false;
    const setSkip = () => {
      try {
        sessionStorage.setItem(cacheKey, "skip");
      } catch {
        // storage may be disabled — just don't cache
      }
    };

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const url =
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=` +
            encodeURIComponent(location);
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) {
            setSkip();
            return;
          }
          const data = (await res.json()) as Array<{
            lat: string;
            lon: string;
          }>;
          if (cancelled) return;
          const first = data[0];
          if (!first) {
            setSkip();
            return;
          }
          const km = haversineKm(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            { lat: parseFloat(first.lat), lng: parseFloat(first.lon) },
          );
          if (!Number.isFinite(km) || km > MAX_WALK_KM) {
            setSkip();
            return;
          }
          const minutes = Math.max(1, Math.round((km / WALKING_KMH) * 60));
          try {
            sessionStorage.setItem(cacheKey, `min:${minutes}`);
          } catch {
            // ignore
          }
          setLabel(`${minutes} min walk`);
        } catch {
          setSkip();
        }
      },
      () => {
        setSkip();
      },
      { maximumAge: 5 * 60 * 1000, timeout: 5000 },
    );

    return () => {
      cancelled = true;
    };
  }, [location]);

  if (!label) return null;
  return <span className={className}>{label}</span>;
}
