type Status = "active" | "done" | "cancelled";

type Props = {
  status: Status;
  startsAt: Date;
  // Server-rendered `now` for the page; passing in keeps the elapsed check
  // consistent with the parent's upcoming/past partitioning.
  now: Date;
};

const STYLE: Record<"upcoming" | "done" | "cancelled", string> = {
  upcoming:
    "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  done:
    "bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900",
  cancelled:
    "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
};

export function StatusPill({ status, startsAt, now }: Props) {
  // Active plans whose start time has passed are auto-shown in the Past
  // section; labelling them "Upcoming" would be misleading, so omit the pill.
  if (status === "active" && startsAt <= now) return null;
  const display: keyof typeof STYLE =
    status === "done" ? "done" : status === "cancelled" ? "cancelled" : "upcoming";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STYLE[display]}`}
    >
      {display}
    </span>
  );
}
