// Clerk's `image_url` returns a hosted default avatar (purple/indigo blob)
// for users without a profile photo. Detect it so we can show our own
// paper-styled initials fallback instead. Format:
//   https://img.clerk.com/<base64({"type":"default", ...})>
// The `"type":"default"` JSON snippet base64-encodes to a stable prefix
// because keys are emitted in insertion order — checking the encoded prefix
// avoids decoding on every avatar render.
const CLERK_DEFAULT_PAYLOAD_PREFIX = "eyJ0eXBlIjoiZGVmYXVsdCI";

export function isClerkDefaultAvatar(url: string | null): boolean {
  if (!url) return false;
  return (
    url.startsWith("https://img.clerk.com/") &&
    url.includes(CLERK_DEFAULT_PAYLOAD_PREFIX)
  );
}

// Returns the URL to render, or null when we should fall back to initials.
export function normalizeAvatarUrl(url: string | null): string | null {
  if (!url) return null;
  if (isClerkDefaultAvatar(url)) return null;
  return url;
}
