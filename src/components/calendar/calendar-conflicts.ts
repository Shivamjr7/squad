import { overlaps } from "@/lib/conflicts-overlap";
import type { CalendarCommitment } from "@/lib/actions/conflicts";

// Hard supersedes soft. §2 Severity:
//   hard — both sides IN/creator, both non-approximate, overlap ≥ 1 min
//   soft — at least one MAYBE, or at least one approximate
//
// We never store this on the row — it's a property of a pair. The per-item
// flag here is "what's the worst conflict touching this commitment in the
// visible set?", computed once per render.
export type ConflictSeverity = "hard" | "soft" | null;

export type AnnotatedCommitment = CalendarCommitment & {
  conflict: ConflictSeverity;
};

function pairSeverity(
  a: CalendarCommitment,
  b: CalendarCommitment,
): ConflictSeverity {
  if (!overlaps({ start: a.start, end: a.end }, { start: b.start, end: b.end })) {
    return null;
  }
  if (
    a.isApproximate ||
    b.isApproximate ||
    a.vote === "maybe" ||
    b.vote === "maybe"
  ) {
    return "soft";
  }
  return "hard";
}

export function annotateConflicts(
  items: CalendarCommitment[],
): AnnotatedCommitment[] {
  return items.map((item, i) => {
    let worst: ConflictSeverity = null;
    for (let j = 0; j < items.length; j += 1) {
      if (j === i) continue;
      const sev = pairSeverity(item, items[j]!);
      if (sev === "hard") {
        worst = "hard";
        break;
      }
      if (sev === "soft") worst = "soft";
    }
    return { ...item, conflict: worst };
  });
}
