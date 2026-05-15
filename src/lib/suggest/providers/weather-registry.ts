// Suggest Plan — WeatherProvider registry (S9). Singleton seam, parallel
// to ./registry.ts for activity providers. First registration wins; v1 only
// ships openweather, but the seam is in place so a future provider can be
// added with a single `import "./acme-weather"` line in ./index.ts.

import type { WeatherProvider } from "@/lib/suggest/types";

let active: WeatherProvider | null = null;

export function registerWeatherProvider(provider: WeatherProvider): void {
  if (active === null) active = provider;
}

export function getWeatherProvider(): WeatherProvider | null {
  return active;
}

/** Test-only override; throws outside NODE_ENV=test. */
export function setWeatherProvider(provider: WeatherProvider | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setWeatherProvider() is test-only.");
  }
  active = provider;
}
