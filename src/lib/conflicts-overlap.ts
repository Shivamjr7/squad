// Pure overlap predicate, shared by:
//   • src/lib/actions/conflicts.ts → getUserCommitments range filter
//   • client-side conflict surfaces (warning sheet, calendar dot, compare)
// Kept dep-free so vitest can exercise it without the action-module graph
// (clerk, drizzle, postgres) coming along for the ride. See
// CONVERGENCE_PLAN.md §2 for the defining equation.

export type TimeRange = { start: Date; end: Date };

// Half-open: A.start < B.end AND B.start < A.end. Adjacency at the boundary
// (A.end === B.start) is intentionally NOT an overlap — back-to-back plans
// shouldn't ping as a conflict.
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}
