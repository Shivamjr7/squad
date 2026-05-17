import { cn } from "@/lib/utils";

const CORAL = "#FF7B4D";

// Squad brandmark — italic serif "S" with a Tartine orange "live" dot
// in the top-right "first quadrant" (the same spot the deciding pulse
// occupies on a plan card). The S inherits currentColor so callers pair
// it with text-ink on light bg / text-paper on dark bg. The dot is a
// brand constant, not themable.
export function SquadLogo({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("block", className)}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <text
        x="11.5"
        y="18.4"
        fontFamily="var(--font-instrument-serif), Cambria, Georgia, serif"
        fontStyle="italic"
        fontWeight={400}
        fontSize="22"
        textAnchor="middle"
        fill="currentColor"
      >
        S
      </text>
      <circle cx="19.5" cy="5" r="1.7" fill={CORAL} />
    </svg>
  );
}

// Wordmark — italic serif "Squad" with the Tartine orange dot riding
// off the upper-right. Inline-with-text variant of the brandmark; used
// in nav and sidebar headers. The dot replaces the period — same shape
// language as the icon, but anchored to the wordmark instead of a
// square tile.
export function SquadWordmark({
  className,
  tone = "ink",
}: {
  className?: string;
  tone?: "ink" | "coral";
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-baseline font-instrument-serif italic leading-none",
        tone === "coral" ? "text-coral" : "text-ink",
        className,
      )}
    >
      <span>Squad</span>
      <span
        aria-hidden
        className="ml-[2px] inline-block size-[0.28em] self-start rounded-full"
        style={{ background: CORAL }}
      />
    </span>
  );
}
