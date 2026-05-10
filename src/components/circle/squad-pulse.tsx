import { cn } from "@/lib/utils";

export type PulseMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  // Last in-app activity timestamp (max of votes.voted_at and plans.created_at
  // for plans they created). Null = no recorded activity.
  lastActiveAt: Date | null;
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
  const palette = [
    "bg-coral/20 text-coral",
    "bg-in/15 text-in",
    "bg-maybe/25 text-amber-700",
    "bg-blue-500/15 text-blue-700",
    "bg-purple-500/15 text-purple-700",
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
}: {
  members: PulseMember[];
  now: Date;
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
}: {
  members: PulseMember[];
  now: Date;
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
      {rows.map(({ member, label }) => (
        <span
          key={member.userId}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-paper-card px-2.5 py-1 text-xs"
          title={`${member.displayName} · ${label}`}
        >
          <Avatar
            displayName={member.displayName}
            avatarUrl={member.avatarUrl}
            userId={member.userId}
            size="sm"
          />
          <span className="text-ink-muted">{label}</span>
        </span>
      ))}
    </div>
  );
}

function Avatar({
  displayName,
  avatarUrl,
  userId,
  size = "md",
}: {
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "size-5 text-[10px]" : "size-8 text-xs";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          dim,
        )}
      />
    );
  }
  return (
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
}
