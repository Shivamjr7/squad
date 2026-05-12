"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

// "Show past plans" toggle on the Plans tab. Writes `showPast=1` into the
// URL so the expansion survives back/forward navigation and links shared
// to a friend already include it. Server re-renders the PAST bucket
// fully — no client-side fetch.
export function ShowPastClient({ count }: { count: number }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  const onClick = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("showPast", "1");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-ink-subtle bg-paper-card/60 px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
    >
      <ChevronDown className="size-3" aria-hidden />
      Show {count} past {count === 1 ? "plan" : "plans"}
    </button>
  );
}
