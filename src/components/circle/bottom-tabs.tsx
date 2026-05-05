"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  label: string;
  href: (slug: string) => string;
  icon: typeof Calendar;
  match: (path: string, slug: string) => boolean;
};

const TABS: Tab[] = [
  {
    label: "Plans",
    href: (slug) => `/c/${slug}`,
    icon: Calendar,
    match: (path, slug) =>
      path === `/c/${slug}` ||
      path.startsWith(`/c/${slug}/p/`) ||
      path === `/c/${slug}/settings`,
  },
  {
    label: "Squad",
    href: (slug) => `/c/${slug}/squad`,
    icon: Users,
    match: (path, slug) => path === `/c/${slug}/squad`,
  },
  {
    label: "You",
    href: (slug) => `/c/${slug}/you`,
    icon: User,
    match: (path, slug) => path === `/c/${slug}/you`,
  },
];

export function BottomTabs({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Circle navigation"
      className={cn(
        "fixed inset-x-0 z-30 mx-auto flex w-full max-w-md justify-around border-t border-ink/10 bg-paper/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-paper/80",
        "bottom-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5",
        "md:inset-x-auto md:bottom-6 md:left-1/2 md:max-w-none md:-translate-x-1/2 md:rounded-full md:border md:border-ink/10 md:px-2 md:py-1.5 md:shadow-[0_8px_24px_-12px_rgba(20,15,10,0.18)]",
      )}
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname, slug);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.label}
            href={tab.href(slug)}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors md:min-w-20 md:flex-none md:flex-row md:gap-2 md:px-4 md:py-2 md:text-sm",
              active
                ? "text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon
              className={cn(
                "size-5 transition-transform md:size-4",
                active ? "scale-105" : "scale-100",
              )}
              aria-hidden
              strokeWidth={active ? 2.25 : 1.75}
            />
            <span className={cn(active && "font-semibold")}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
