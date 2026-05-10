function formatToLock(diffMs: number): string | null {
  if (diffMs <= 0) return null;
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 60) return `${totalMin}m to lock`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin - hr * 60;
  return min === 0 ? `${hr}h to lock` : `${hr}h ${min}m to lock`;
}

export function HomeSubline({
  decidingCount,
  decideBy,
  weighedIn,
  totalMembers,
  now,
}: {
  decidingCount: number;
  decideBy: Date | null;
  weighedIn: number;
  totalMembers: number;
  now: Date;
}) {
  const parts: string[] = [];
  if (decidingCount > 0) {
    parts.push(`${decidingCount} plan${decidingCount === 1 ? "" : "s"} deciding`);
  }
  const toLock = decideBy ? formatToLock(decideBy.getTime() - now.getTime()) : null;
  if (toLock) parts.push(toLock);
  if (totalMembers > 0) {
    parts.push(`${weighedIn} of ${totalMembers} have weighed in`);
  }
  if (parts.length === 0) return null;
  return (
    <p className="text-sm text-ink-muted">{parts.join(" · ")}</p>
  );
}
