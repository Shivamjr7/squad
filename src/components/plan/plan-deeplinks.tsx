import { CalendarPlus, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalkingTimeHint } from "./walking-time-hint";

// M25 — deep-link cluster used on the decision card + receipt. Tones map to
// the surrounding card palette: light = paper, dark = live-ticker, cream =
// receipt. Walking-time hint sits below and stays hidden unless geolocation
// resolves to a coordinate within walking range.

type Tone = "light" | "dark" | "cream";

const baseBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors";

const TONES: Record<
  Tone,
  { primary: string; secondary: string; muted: string; hint: string }
> = {
  light: {
    primary: "bg-ink text-paper hover:bg-ink/90",
    secondary: "border border-ink/15 text-ink hover:bg-ink/5",
    muted: "text-ink-muted hover:text-ink",
    hint: "text-ink-muted",
  },
  dark: {
    primary: "bg-white text-[#0e0e0e] hover:bg-white/90",
    secondary: "border border-white/20 text-white/90 hover:bg-white/5",
    muted: "text-white/60 hover:text-white",
    hint: "text-white/45",
  },
  cream: {
    primary: "bg-ink text-[#f4eedb] hover:bg-ink/90",
    secondary: "border border-ink/25 text-ink hover:bg-ink/5",
    muted: "text-ink-muted hover:text-ink",
    hint: "text-ink-muted",
  },
};

export type PlanDeepLinksProps = {
  mapsUrl: string | null;
  icsUrl: string;
  gcalUrl: string;
  location: string | null;
  tone?: Tone;
};

export function PlanDeepLinks({
  mapsUrl,
  icsUrl,
  gcalUrl,
  location,
  tone = "light",
}: PlanDeepLinksProps) {
  const t = TONES[tone];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(baseBtn, t.primary)}
          >
            <MapPin className="size-3.5" aria-hidden />
            Open in Maps
          </a>
        ) : null}
        <a href={icsUrl} className={cn(baseBtn, t.secondary)}>
          <CalendarPlus className="size-3.5" aria-hidden />
          Add to calendar
        </a>
        <a
          href={gcalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "text-xs underline-offset-2 hover:underline",
            t.muted,
          )}
        >
          Google Calendar
        </a>
      </div>
      <WalkingTimeHint location={location} className={cn("text-[11px]", t.hint)} />
    </div>
  );
}
