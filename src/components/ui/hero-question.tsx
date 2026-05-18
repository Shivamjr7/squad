import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The brand's hero question pattern — sans-serif `prefix` + italic-serif
// `accent` (always coral) + sans-serif `suffix`. Examples in the wild:
//   "Tonight, *Kaioken*?"
//   "What's the move?"   (no accent — render with accent only as the
//                          entire "move" word, or leave blank)
//   "Anyone free *tonight*?"
//   "What's on, *this week*"
//
// Centralizing here so the font, kerning, italic-class, and color stay
// identical across screens. `as` lets non-page heroes opt out of <h1>
// when the parent has its own heading already.

type Size = "lg" | "md";

type Props = {
  /** Plain text before the italic accent. */
  prefix?: ReactNode;
  /** The italic-serif coral word(s). */
  accent?: ReactNode;
  /** Plain text after the accent — typically punctuation like "?" or ".". */
  suffix?: ReactNode;
  size?: Size;
  /** Override the HTML tag (default `h1`). */
  as?: "h1" | "h2" | "p";
  className?: string;
};

const SIZE_CLASS: Record<Size, string> = {
  // lg = page-level hero. Matches the existing in-circle home + landing.
  lg: "text-[34px] leading-[1.1] sm:text-[40px] md:text-[56px] md:leading-[1.05]",
  // md = section-level hero. Matches My plans, plan-detail subhead, etc.
  md: "text-3xl leading-tight sm:text-4xl",
};

export function HeroQuestion({
  prefix,
  accent,
  suffix,
  size = "lg",
  as: Tag = "h1",
  className,
}: Props) {
  return (
    <Tag
      className={cn(
        "font-serif font-semibold text-ink",
        // Optical kerning + ligatures on the serif so the italic accent
        // sits cleanly against the upright sans of the prefix/suffix.
        "[font-feature-settings:'kern','liga','dlig']",
        SIZE_CLASS[size],
        className,
      )}
    >
      {prefix}
      {prefix && accent ? " " : null}
      {accent ? (
        <em className="font-serif italic font-normal text-coral">{accent}</em>
      ) : null}
      {suffix}
    </Tag>
  );
}
