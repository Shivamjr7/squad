"use client";

import { useEffect, useState } from "react";

type Weather = {
  temp: number;
  code: number;
};

// WMO weather code → small ASCII / emoji-free icon. Open-Meteo uses these
// codes for current_weather.weathercode.
function codeToIcon(code: number): string {
  if (code === 0) return "☀";
  if (code === 1 || code === 2) return "⛅";
  if (code === 3) return "☁";
  if (code >= 45 && code <= 48) return "🌫";
  if (code >= 51 && code <= 67) return "🌦";
  if (code >= 71 && code <= 77) return "🌨";
  if (code >= 80 && code <= 82) return "🌧";
  if (code >= 95) return "⛈";
  return "·";
}

export function WeatherChip() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setHidden(true);
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${pos.coords.latitude.toFixed(2)}` +
            `&longitude=${pos.coords.longitude.toFixed(2)}` +
            `&current_weather=true&temperature_unit=celsius`;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("weather");
          const data = (await res.json()) as {
            current_weather?: { temperature?: number; weathercode?: number };
          };
          if (cancelled) return;
          const cw = data.current_weather;
          if (typeof cw?.temperature !== "number" || typeof cw?.weathercode !== "number") {
            setHidden(true);
            return;
          }
          setWeather({ temp: Math.round(cw.temperature), code: cw.weathercode });
        } catch {
          if (!cancelled) setHidden(true);
        }
      },
      () => {
        if (!cancelled) setHidden(true);
      },
      { timeout: 8_000, maximumAge: 15 * 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || !weather) return null;

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
      <span aria-hidden>{codeToIcon(weather.code)}</span>
      <span>{weather.temp}°</span>
    </span>
  );
}
