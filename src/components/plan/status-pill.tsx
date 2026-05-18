import { Pill, type PillTone } from "@/components/ui/pill";

type Status = "active" | "confirmed" | "done" | "cancelled";

type Props = {
  status: Status;
  startsAt: Date;
  // Server-rendered `now` for the page; passing in keeps the elapsed check
  // consistent with the parent's upcoming/past partitioning.
  now: Date;
};

type Display = "upcoming" | "confirmed" | "done" | "cancelled";

const TONE: Record<Display, PillTone> = {
  // Coral = "still being decided" (matches the home featured-card "Deciding"
  // pill so the visual language is consistent across surfaces).
  upcoming: "coral",
  confirmed: "in",
  done: "muted",
  // Same red the Out vote button uses.
  cancelled: "out",
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
    <Pill tone={TONE[display]} size="sm" variant="outline" className="shrink-0">
      {LABEL[display]}
    </Pill>
  );
}
