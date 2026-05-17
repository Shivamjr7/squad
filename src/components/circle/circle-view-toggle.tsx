import Link from "next/link";
import { cn } from "@/lib/utils";

// Segmented "All plans · My plans" control mounted at the top of /c/[slug]
// (Home) and /c/[slug]/plans (My plans). Replaces the "My plans" bottom-tab
// entry trimmed from Sidebar in #4 — the bar shrank to four icons and these
// two views became halves of one toggle instead of separate tabs. Two
// routes keep notification deep-links / browser back stack honest.
export function CircleViewToggle({
  slug,
  active,
  className,
}: {
  slug: string;
  active: "all" | "mine";
  className?: string;
}) {
  return (
    <nav
      aria-label="Plans view"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-ink-subtle bg-paper-card/60 p-1 text-sm",
        className,
      )}
    >
      <ToggleLink
        href={`/c/${slug}`}
        label="All plans"
        active={active === "all"}
      />
      <ToggleLink
        href={`/c/${slug}/plans`}
        label="My plans"
        active={active === "mine"}
      />
    </nav>
  );
}

function ToggleLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // scroll={false} so flipping between the two halves of the same
      // surface keeps the user's scroll position — the toggle is meant to
      // feel like a tab, not a fresh navigation.
      scroll={false}
      className={cn(
        "inline-flex min-w-[88px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        active
          ? "bg-paper-elevated text-ink shadow-card"
          : "text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
