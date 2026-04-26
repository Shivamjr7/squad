export const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_SLUGS = [
  "onboarding",
  "invite",
  "sign-in",
  "sign-up",
  "api",
  "c",
  "_next",
  "admin",
  "settings",
  "dashboard",
  "about",
  "privacy",
  "terms",
  "help",
  "support",
  "app",
  "home",
  "index",
  "webhooks",
  "null",
  "undefined",
  "true",
  "false",
] as const;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}
