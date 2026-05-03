"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { UserCircle } from "@/lib/circles";
import { cn } from "@/lib/utils";

type Size = "lg" | "sm";

type Props = {
  currentSlug: string;
  circles: UserCircle[];
  size?: Size;
};

const TITLE_CLASS: Record<Size, string> = {
  lg: "text-xl font-semibold tracking-tight",
  sm: "text-base font-semibold tracking-tight",
};

const CHEVRON_CLASS: Record<Size, string> = {
  lg: "size-5",
  sm: "size-4",
};

export function CircleSwitcher({ currentSlug, circles, size = "lg" }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = circles.find((c) => c.slug === currentSlug);

  // Sort: current first, then most-recent join order (already from query),
  // so the active circle is always the top row.
  const sorted = current
    ? [current, ...circles.filter((c) => c.slug !== currentSlug)]
    : circles;

  const triggerLabel = current?.name ?? currentSlug;

  return (
    <>
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="-ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left active:bg-muted"
          aria-label="Switch circle"
        >
          <span className={cn("truncate", TITLE_CLASS[size])}>
            {triggerLabel}
          </span>
          <ChevronDown
            className={cn("shrink-0 text-muted-foreground", CHEVRON_CLASS[size])}
            aria-hidden
          />
        </button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="w-80 max-w-full p-0">
            <SheetHeader className="border-b">
              <SheetTitle className="text-base">Your circles</SheetTitle>
            </SheetHeader>
            <CircleList
              circles={sorted}
              currentSlug={currentSlug}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden sm:block">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted/60"
              aria-label="Switch circle"
            >
              <span className={cn("truncate", TITLE_CLASS[size])}>
                {triggerLabel}
              </span>
              <ChevronDown
                className={cn(
                  "shrink-0 text-muted-foreground",
                  CHEVRON_CLASS[size],
                )}
                aria-hidden
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <CircleList circles={sorted} currentSlug={currentSlug} />
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

function CircleList({
  circles,
  currentSlug,
  onNavigate,
}: {
  circles: UserCircle[];
  currentSlug: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col p-1">
        {circles.map((c) => {
          const isCurrent = c.slug === currentSlug;
          return (
            <li key={c.id}>
              <Link
                href={`/c/${c.slug}`}
                prefetch={false}
                onClick={onNavigate}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                  isCurrent && "bg-muted/70",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isCurrent ? "text-foreground" : "invisible",
                  )}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate",
                      isCurrent ? "font-semibold" : "font-medium",
                    )}
                  >
                    {c.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    {c.role === "admin" ? " · Admin" : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t p-1">
        <Link
          href="/onboarding"
          prefetch={false}
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="size-4" aria-hidden />
          Add another circle
        </Link>
      </div>
    </div>
  );
}
