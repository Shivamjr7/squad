// M25 — UA-aware maps deep-link. iOS Safari is the only stack where Apple
// Maps is the natural choice (everywhere else falls back to Google Maps).
// Detection has to exclude the Chromium/Firefox iOS shells, which carry
// "iPhone" but route into Google Maps when given a maps.apple.com URL via a
// share sheet. UA-sniffing is good enough here — the consequence of a wrong
// guess is "opens the other app," not data loss.
export function isIOSSafari(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  if (!/iPhone|iPad|iPod/.test(userAgent)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)) return false;
  return /Safari/.test(userAgent);
}

export function buildMapsUrl(
  location: string,
  userAgent: string | null | undefined,
): string {
  const q = encodeURIComponent(location);
  if (isIOSSafari(userAgent)) {
    return `https://maps.apple.com/?q=${q}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
