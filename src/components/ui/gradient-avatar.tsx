import Image from "next/image";
import { cn } from "@/lib/utils";
import { normalizeAvatarUrl } from "@/lib/avatar";

// Seeded 2-stop conic gradient avatar. Modern apps (Linear, Vercel, etc.)
// generate per-user gradients so unphotographed members still feel
// individual — flat muted circles were what we had before and they all
// looked the same.
//
// The gradient is deterministic: same userId always produces the same
// hue pair, in both themes. We pick from a curated palette of OKLCH
// pairs that look good on cream + on midnight, so we never have to
// theme-branch at render time.
//
// When `src` resolves to a non-default avatar URL (Clerk default URLs
// are filtered by `normalizeAvatarUrl`), we render the photo instead and
// keep the gradient as a single-frame fallback during load.

type Size = "xs" | "sm" | "md" | "lg" | "xl";

type Props = {
  /** User id (or any stable string). Drives the gradient pair. */
  seed: string;
  /** Display name — for alt text and initials fallback. */
  name: string | null | undefined;
  /** Photo URL. Clerk default avatars are filtered automatically. */
  src?: string | null;
  size?: Size;
  /** Soft 1px ring around the avatar — useful on overlapping voter stacks. */
  ring?: boolean;
  className?: string;
};

const SIZE_PX: Record<Size, number> = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 36,
  xl: 56,
};

const SIZE_CLASS: Record<Size, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
  xl: "size-14 text-lg",
};

// Curated OKLCH gradient pairs. Each entry = [from, to]. Picked for
// chromatic variety + dual-theme legibility. Initials are rendered in
// paper-cream with a soft black scrim for contrast at any pair.
const GRADIENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["oklch(0.72 0.20 28)", "oklch(0.58 0.20 358)"], // coral → magenta
  ["oklch(0.70 0.18 145)", "oklch(0.60 0.18 200)"], // green → teal
  ["oklch(0.74 0.18 60)", "oklch(0.64 0.22 28)"], // mustard → coral
  ["oklch(0.66 0.20 268)", "oklch(0.58 0.20 320)"], // violet → pink
  ["oklch(0.74 0.16 200)", "oklch(0.62 0.20 248)"], // teal → blue
  ["oklch(0.74 0.16 90)", "oklch(0.62 0.20 145)"], // citrus → green
  ["oklch(0.66 0.20 320)", "oklch(0.56 0.20 268)"], // pink → violet
  ["oklch(0.68 0.20 25)", "oklch(0.60 0.20 60)"], // red → orange
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function GradientAvatar({
  seed,
  name,
  src,
  size = "md",
  ring = false,
  className,
}: Props) {
  const resolvedSrc = normalizeAvatarUrl(src ?? null);
  const initials = initialsFromName(name);
  const hash = hashSeed(seed || initials);
  const [from, to] = GRADIENT_PAIRS[hash % GRADIENT_PAIRS.length]!;
  // Angle also seeded so even users that collide on the pair will rotate
  // differently — small touch, doubles the apparent variety.
  const angle = (hash >> 3) % 360;

  const ringClass = ring ? "ring-2 ring-paper" : "";

  if (resolvedSrc) {
    return (
      <span
        className={cn(
          "relative inline-flex shrink-0 overflow-hidden rounded-full",
          SIZE_CLASS[size],
          ringClass,
          className,
        )}
        style={{
          backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})`,
        }}
      >
        <Image
          src={resolvedSrc}
          alt={name ?? "avatar"}
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          className="size-full object-cover"
          unoptimized
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={name ?? "avatar"}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase text-paper",
        SIZE_CLASS[size],
        ringClass,
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})`,
      }}
    >
      {/* Soft scrim so initials stay legible on any gradient pair. */}
      <span aria-hidden className="absolute inset-0 rounded-full bg-ink/15" />
      <span className="relative tracking-tight">{initials}</span>
    </span>
  );
}
