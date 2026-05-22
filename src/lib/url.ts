import { headers } from "next/headers";

// Reject everything that isn't a same-origin path. Blocks open-redirect
// chains like `/sign-in?redirect_url=https://evil.com` or `//evil.com`
// (protocol-relative) and `/\evil.com` (Windows-style). Also rejects
// re-entering the auth routes to avoid redirect loops post-signin.
export function safeInternalPath(
  input: string | undefined | null,
  fallback = "/",
): string {
  if (!input) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (input.startsWith("/sign-in") || input.startsWith("/sign-up")) {
    return fallback;
  }
  return input;
}

export async function getAppUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) {
    throw new Error(
      "Cannot determine app URL: set NEXT_PUBLIC_APP_URL or ensure host header is forwarded.",
    );
  }
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
