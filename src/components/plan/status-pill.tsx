type Status = "active" | "confirmed" | "done" | "cancelled";

type Props = {
  status: Status;
  startsAt: Date;
  // Server-rendered `now` for the page; passing in keeps the elapsed check
  // consistent with the parent's upcoming/past partitioning.
  now: Date;
};

type Display = "upcoming" | "confirmed" | "done" | "cancelled";

const STYLE: Record<Display, string> = {
  // Coral = "still being decided" (matches the home featured-card "Deciding"
  // pill so the visual language is consistent across surfaces).
  upcoming: "bg-coral-soft text-coral-strong ring-1 ring-coral-soft",
  // --in reserved for the loudest positive signal (locked in).
  confirmed: "bg-in-soft text-in-strong ring-1 ring-in-soft",
  // Past plans go quiet — slightly lifted card surface so they don't
  // disappear into the body on the dark theme.
  done: "bg-paper-card text-ink-muted ring-1 ring-ink-subtle",
  // --out for cancelled — same red the Out vote button uses.
  cancelled: "bg-out-soft text-out-strong ring-1 ring-out-soft",
};

const LABEL: Record<Display, string> = {
  upcoming: "upcoming",
  confirmed: "✓ confirmed",
  done: "done",
  cancelled: "cancelled",
};

export function StatusPill({ status, startsAt, now }: Props) {
  // Active plans whose start time has passed are auto-shown in the Past
  // section; labelling them "Upcoming" would be misleading, so omit the pill.
  if (status === "active" && startsAt <= now) return null;
  const display: Display =
    status === "done"
      ? "done"
      : status === "cancelled"
        ? "cancelled"
        : status === "confirmed"
          ? "confirmed"
          : "upcoming";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STYLE[display]}`}
    >
      {LABEL[display]}
    </span>
  );
}
