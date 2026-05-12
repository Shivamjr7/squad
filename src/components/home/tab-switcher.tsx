"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type HomeTab = "circles" | "plans";

// Builds the href for a given tab while preserving any other search params
// the user already had set (filters, etc. on the Plans tab). Drops the
// `tab` key when navigating to the default (circles) so the URL stays
// clean on first load.
function buildHref(
  pathname: string,
  params: URLSearchParams,
  next: HomeTab,
): string {
  const search = new URLSearchParams(params);
  if (next === "circles") {
    search.delete("tab");
    // Filters apply only to the Plans tab — strip them so they don't
    // resurface stale when the user returns to Plans later.
    search.delete("circle");
    search.delete("time");
    search.delete("needs");
    search.delete("locked");
    search.delete("showPast");
  } else {
    search.set("tab", next);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function HomeTabSwitcher({ active }: { active: HomeTab }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString() ?? "");

  const tabs: { key: HomeTab; label: string }[] = [
    { key: "circles", label: "Circles" },
    { key: "plans", label: "Plans" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Home view"
      className="flex items-center gap-1 rounded-full border border-ink-subtle bg-paper-card/60 p-1"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={buildHref(pathname, params, tab.key)}
            role="tab"
            aria-selected={isActive}
            // Hard nav scroll handling — Next's default preserves scroll
            // position on same-page navigation, which is what we want when
            // switching between tabs.
            scroll={false}
            className={cn(
              "inline-flex min-w-[88px] items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              isActive
                ? "bg-paper-elevated text-ink shadow-card"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
