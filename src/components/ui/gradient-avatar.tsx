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

// Curated OKLCH flat fills — Editorial Calm family. All sit in the same
// mid-tone lightness band (0.42–0.56) and the same low-chroma band
// (0.08–0.14) so a stack of avatars reads as one harmonious set.
// Eight hues across warm earth tones + cool deep tones for variety
// without noise.
const AVATAR_FILLS: ReadonlyArray<string> = [
  "oklch(0.52 0.12 22)", // terra-cotta
  "oklch(0.46 0.10 40)", // tobacco brown
  "oklch(0.50 0.10 105)", // mossy olive
  "oklch(0.46 0.10 220)", // deep teal
  "oklch(0.42 0.08 270)", // slate navy
  "oklch(0.44 0.10 330)", // muted plum
  "oklch(0.52 0.12 55)", // warm clay
  "oklch(0.50 0.10 5)", // dusty rose
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
