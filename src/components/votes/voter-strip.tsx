"use client";

import type { Voter } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { cn } from "@/lib/utils";

const META: Record<VoteStatus, { emoji: string; label: string }> = {
  in: { emoji: "🟢", label: "In" },
  maybe: { emoji: "🟡", label: "Maybe" },
  out: { emoji: "🔴", label: "Out" },
};

// At ≤4 voters we show avatars + first names inline. At ≥5 we collapse to a
// count so the strip fits one row at 380px without pushing content below the
// fold.
const INLINE_THRESHOLD = 4;

function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

export function VoterStrip({
  status,
  voters,
  density,
  onOpen,
}: {
  status: VoteStatus;
  voters: Voter[];
  density: "card" | "detail";
  onOpen: () => void;
}) {
  if (voters.length === 0) return null;

  const meta = META[status];
  const sorted = [...voters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const inline = sorted.length <= INLINE_THRESHOLD;
  const avatarSize = density === "detail" ? "size-6" : "size-5";
  const fontSize = density === "detail" ? "text-sm" : "text-xs";

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen();
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={`View ${meta.label} voters (${sorted.length})`}
      className={cn(
        "flex w-full touch-manipulation items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100",
        "hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        fontSize,
      )}
    >
      <span aria-hidden className="shrink-0">
        {meta.emoji}
      </span>
      {inline ? (
        <>
          <span className="flex shrink-0 -space-x-1.5">
            {sorted.map((v) => (
              <Avatar
                key={v.userId}
                displayName={v.displayName}
                avatarUrl={v.avatarUrl}
                size={avatarSize}
              />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {sorted.map((v) => firstName(v.displayName)).join(", ")}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {sorted.length}
          </span>{" "}
          {meta.label.toLowerCase()}
        </span>
      )}
    </button>
  );
}

function Avatar({
  displayName,
  avatarUrl,
  size,
}: {
  displayName: string;
  avatarUrl: string | null;
  size: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn(
          "rounded-full object-cover ring-2 ring-card",
          size,
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase ring-2 ring-card",
        size,
      )}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}
