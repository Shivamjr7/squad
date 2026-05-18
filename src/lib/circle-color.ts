// Deterministic per-circle color from the circle id. No `colour` column on
// circles in the schema — we hash the id into a small palette so the same
// circle always gets the same dot color across Sidebar, cross-circle feed,
// and notification chips.

// Palette is intentionally a mix of semantic tokens (coral/in/maybe/voting)
// and a couple of Tailwind hues to keep enough chromatic variety for 6+
// circles. Semantic tokens flip cleanly in dark mode; the two purple/
// emerald entries already read well in both themes.
export const CIRCLE_DOT_PALETTE = [
  "bg-coral",
  "bg-in",
  "bg-maybe",
  "bg-voting",
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
