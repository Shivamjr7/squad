"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, ClipboardList, Menu, Users, User } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Home", href: (slug: string) => `/c/${slug}`, icon: Calendar },
  { label: "My plans", href: (slug: string) => `/c/${slug}/plans`, icon: ClipboardList },
  { label: "Squad", href: (slug: string) => `/c/${slug}/squad`, icon: Users },
  { label: "You", href: (slug: string) => `/c/${slug}/you`, icon: User },
];

export function CircleSideMenu({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="rounded-3xl border border-ink/10 bg-paper p-4 text-sm text-ink-muted shadow-sm">
      <div className="mb-4 border-b border-ink/10 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Circle menu
      </div>
      <div className="space-y-2">
        {ITEMS.map((item) => {
          const href = item.href(slug);
          const active = pathname === href;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={href}
              prefetch={false}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors",
                active
                  ? "bg-ink text-paper-card"
                  : "text-ink-muted hover:bg-paper-card hover:text-ink",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function CircleSideMenuMobile({ slug }: { slug: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink/10 bg-paper text-ink transition hover:bg-paper-card lg:hidden"
          aria-label="Open circle menu"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
        <div className="h-full overflow-y-auto">
          <CircleSideMenu slug={slug} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
