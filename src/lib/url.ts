import { headers } from "next/headers";

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
