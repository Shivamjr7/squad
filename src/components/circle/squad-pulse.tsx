import { cn } from "@/lib/utils";
import type { VoteStatus } from "@/lib/validation/vote";

export type PulseMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  // Last in-app activity timestamp (max of votes.voted_at and plans.created_at
  // for plans they created). Null = no recorded activity.
  lastActiveAt: Date | null;
};

// Optional per-user vote on the current featured plan. Drives a small
// presence-dot in the corner of each pulse avatar so the strip answers
// "who's around" AND "where they landed on tonight's plan".
type VoteByUser = Record<string, VoteStatus>;

const VOTE_DOT_CLASS: Record<VoteStatus, string> = {
  in: "bg-in",
  maybe: "bg-maybe",
  out: "bg-out",
};

const VOTE_LABEL: Record<VoteStatus, string> = {
  in: "in",
  maybe: "maybe",
  out: "out",
};

const DAY_MS = 86_400_000;

function relativeLastActive(d: Date, now: Date): string | null {
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) return "yesterday";
  // Older than yesterday → return null so caller can hide the row.
  return null;
}

function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

function colorForUser(userId: string): string {
  // Deterministic small palette so the same person always gets the same hue.
  // Bright text variants for the dark theme — see Sidebar.tsx for rationale.
  const palette = [
    "bg-coral/20 text-coral",
    "bg-in/15 text-in",
    "bg-maybe/25 text-maybe",
    "bg-voting/15 text-voting-strong",
    "bg-purple-500/15 text-purple-300",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length]!;
}

export function SquadPulse({
  members,
  now,
  voteByUser,
}: {
  members: PulseMember[];
  now: Date;
  voteByUser?: VoteByUser;
}) {
  const rows = members
    .map((m) => ({
      member: m,
      label: m.lastActiveAt ? relativeLastActive(m.lastActiveAt, now) : null,
    }))
    .filter(
      (r): r is { member: PulseMember; label: string } => r.label !== null,
    )
    .sort((a, b) => {
      const at = a.member.lastActiveAt?.getTime() ?? 0;
      const bt = b.member.lastActiveAt?.getTime() ?? 0;
      return bt - at;
    });

  return (
    <section
      aria-labelledby="squad-pulse-heading"
      className="rounded-3xl border border-ink/10 bg-paper-card p-4 shadow-sm"
    >
      <h2
        id="squad-pulse-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
      >
        Squad Pulse
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          Quiet so far today. Be the first to chime in.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map(({ member, label }) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 text-sm"
            >
              <Avatar
                displayName={member.displayName}
                avatarUrl={member.avatarUrl}
                userId={member.userId}
                voteStatus={voteByUser?.[member.userId]}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-ink">
                  {member.displayName}
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {label}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SquadPulseInline({
  members,
  now,
  voteByUser,
}: {
  members: PulseMember[];
  now: Date;
  voteByUser?: VoteByUser;
}) {
  // Show every member as a chip on mobile so the strip always renders;
  // fall back to "—" when there's no in-app activity to time-stamp.
  const rows = members
    .map((m) => ({
      member: m,
      label:
        (m.lastActiveAt ? relativeLastActive(m.lastActiveAt, now) : null) ??
        "—",
    }))
    .sort((a, b) => {
      const at = a.member.lastActiveAt?.getTime() ?? 0;
      const bt = b.member.lastActiveAt?.getTime() ?? 0;
      return bt - at;
    })
    .slice(0, 8);

  if (rows.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Pulse
      </span>
      {rows.map(({ member, label }) => {
        const vote = voteByUser?.[member.userId];
        return (
          <span
            key={member.userId}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-paper-card px-2.5 py-1 text-xs"
            title={
              vote
                ? `${member.displayName} · ${label} · ${VOTE_LABEL[vote]}`
                : `${member.displayName} · ${label}`
            }
          >
            <Avatar
              displayName={member.displayName}
              avatarUrl={member.avatarUrl}
              userId={member.userId}
              size="sm"
              voteStatus={vote}
            />
            <span className="text-ink-muted">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function Avatar({
  displayName,
  avatarUrl,
  userId,
  size = "md",
  voteStatus,
}: {
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  size?: "sm" | "md";
  voteStatus?: VoteStatus;
}) {
  const dim = size === "sm" ? "size-5 text-[10px]" : "size-8 text-xs";
  const dotSize = size === "sm" ? "size-1.5" : "size-2.5";
  const inner = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt=""
      className={cn("shrink-0 rounded-full object-cover", dim)}
    />
  ) : (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium uppercase",
        colorForUser(userId),
        dim,
      )}
    >
      {initialFor(displayName)}
    </span>
  );

  // No vote → plain avatar (no extra wrapper). Adding a wrapper only when
  // we have the status dot keeps the simple case allocation-free.
  if (!voteStatus) return inner;

  return (
    <span className={cn("relative inline-block shrink-0", dim)}>
      {inner}
      <span
        aria-label={`Voted ${VOTE_LABEL[voteStatus]}`}
        className={cn(
          "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-paper-card",
          dotSize,
          VOTE_DOT_CLASS[voteStatus],
        )}
      />
    </span>
  );
}
