// Compact countdown for the "DECIDING · 1H46 LEFT" style label on the
// featured plan card. Returns null if the deadline has passed.

export function formatDecideBy(decideBy: Date, now: Date): string | null {
  const diffMs = decideBy.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 60) return `${totalMin}M LEFT`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin - hr * 60;
  if (hr < 24) {
    return min === 0
      ? `${hr}H LEFT`
      : `${hr}H${String(min).padStart(2, "0")} LEFT`;
  }
  const day = Math.floor(hr / 24);
  return `${day}D LEFT`;
}
