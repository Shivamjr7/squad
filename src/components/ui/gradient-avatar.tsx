import Image from "next/image";
import { cn } from "@/lib/utils";
import { normalizeAvatarUrl } from "@/lib/avatar";

// Seeded flat-fill avatar. Each user is mapped to one muted earth-tone
// from a curated palette — deterministic per seed, harmonized across
// the squad so a row of avatars reads as one family (editorial calm)
// rather than a confetti of bright gradients. White initials with a
// soft inner scrim for legibility at any fill.
//
// When `src` resolves to a non-default avatar URL (Clerk default URLs
// are filtered by `normalizeAvatarUrl`), we render the photo instead
// and keep the flat color as a load-state fallback.

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

// Curated OKLCH flat fills — Vibrant Spotlight family. Lightness band
// 0.55–0.62 + chroma 0.14–0.18 so the initials read as saturated, warm
// circles on the dark spotlight surface (matches the reference design)
// while still sitting close enough in tone that a stack reads as one set
// rather than a confetti row.
const AVATAR_FILLS: ReadonlyArray<string> = [
  "oklch(0.62 0.16 40)",  // warm orange
  "oklch(0.58 0.18 22)",  // red-orange
  "oklch(0.56 0.14 200)", // teal
  "oklch(0.56 0.15 250)", // ocean blue
  "oklch(0.58 0.15 145)", // emerald
  "oklch(0.55 0.16 310)", // magenta
  "oklch(0.62 0.16 60)",  // amber
  "oklch(0.58 0.18 5)",   // rose
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
  // Strip any non-letter character (period, comma, emoji, digit, etc.) so a
  // display name like "S." doesn't render its trailing dot inside the
  // 24px avatar bubble where it reads as a typo. Collapse leftover runs of
  // whitespace before splitting into word parts.
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(" ");
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
  const fill = AVATAR_FILLS[hash % AVATAR_FILLS.length]!;

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
        style={{ backgroundColor: fill }}
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
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase tracking-tight text-white",
        SIZE_CLASS[size],
        ringClass,
        className,
      )}
      style={{ backgroundColor: fill }}
    >
      {initials}
    </span>
  );
}
