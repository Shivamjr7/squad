import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

// Bell link + unread badge. Shared by the cross-circle home (app/page.tsx),
// the desktop sidebar header, and the mobile top bar in AppShell. Single
// implementation so badge styling + 9+ cap stay in lockstep across surfaces.
export function NotificationsBellLink({
  slug,
  count,
  className,
}: {
  // Notifications live per-circle today (`/c/[slug]/notifications`) so we
  // always need a slug to route to. Callers that don't have a circle in
  // context pass the user's most-recent circle slug.
  slug: string;
  count: number;
  className?: string;
}) {
  const badge = count > 9 ? "9+" : String(count);
  return (
    <Link
      href={`/c/${slug}/notifications`}
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : "Notifications"
      }
      className={cn(
        // Always-visible paper pill behind the bell — matches the reference
        // design where the icon reads as a contained chrome action against
        // the page background, rather than a bare glyph. The hairline
        // border + soft shadow keep it readable on both light paper and
        // dark surfaces (the semantic tokens flip with theme).
        "relative inline-flex size-9 items-center justify-center rounded-full border border-ink/8 bg-paper-card text-ink shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        className,
      )}
    >
      <Bell className="size-[18px]" aria-hidden />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 animate-badge-pulse items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-paper"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
