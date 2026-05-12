import { cn } from "@/lib/utils";

// Squad brandmark — three dots in a triangle, the visual shorthand for
// "three+ people = a squad." Renders inline SVG so it inherits its color
// from currentColor (CSS color) — pair with text-coral, text-ink, etc.
// at the call site. Stroke connecting line at low opacity reinforces the
// "group" idea without making the mark look busy at favicon sizes.
export function SquadLogo({
  className,
  withConnector = true,
  title,
}: {
  className?: string;
  withConnector?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("block", className)}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {withConnector ? (
        <path
          d="M 12 5.2 L 5.2 18 L 18.8 18 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          opacity="0.22"
        />
      ) : null}
      <circle cx="12" cy="5.2" r="2.4" />
      <circle cx="5.2" cy="18" r="2.4" />
      <circle cx="18.8" cy="18" r="2.4" />
    </svg>
  );
}

// Wordmark variant — the brandmark + "SQUAD" set in tight uppercase
// tracking. Use in nav, sidebar header, etc. The dots use the inherited
// color of the parent; the word picks up text color too.
export function SquadWordmark({
  className,
  tone = "ink",
}: {
  className?: string;
  // Lets the caller signal whether the mark should be coral (brand
  // moment) or ink (chrome). Keeps callers from re-specifying color.
  tone?: "ink" | "coral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-[0.16em]",
        className,
      )}
    >
      <SquadLogo
        className={cn(
          "size-[18px]",
          tone === "coral" ? "text-coral" : "text-ink",
        )}
      />
      <span className={tone === "coral" ? "text-ink" : "text-ink"}>SQUAD</span>
    </span>
  );
}
