// Deterministic per-circle color from the circle id. No `colour` column on
// circles in the schema — we hash the id into a small palette so the same
// circle always gets the same dot color across Sidebar, cross-circle feed,
// and notification chips.

export const CIRCLE_DOT_PALETTE = [
  "bg-coral",
  "bg-in",
  "bg-maybe",
  "bg-blue-500",
  "bg-purple-500",
  "bg-emerald-500",
] as const;

export function circleDotClass(circleId: string): string {
  let hash = 0;
  for (let i = 0; i < circleId.length; i += 1) {
    hash = (hash * 31 + circleId.charCodeAt(i)) >>> 0;
  }
  return CIRCLE_DOT_PALETTE[hash % CIRCLE_DOT_PALETTE.length]!;
}
