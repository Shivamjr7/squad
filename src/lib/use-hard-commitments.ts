"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getMyHardCommitmentsInRange,
  type MyHardCommitment,
} from "@/lib/actions/conflicts";
import { overlaps } from "@/lib/conflicts-overlap";

// M32.4 — shared by the create-plan warning row (§4.2), the time-consensus
// heatmap dot (§4.3), and the counter-proposal dot (§4.3 + scenario 5
// visual). One fetch per (from, to, excludePlanId) tuple; the returned
// `findOverlap(start, end)` is a pure scan over the in-memory array using
// the shared half-open `overlaps` predicate.
//
// `excludePlanId` keeps the current plan's own `starts_at` from painting a
// dot on its own time picker. For the create-plan form there's no plan yet,
// so omit it.
export function useMyHardCommitments(
  fromUtc: Date | null,
  toUtc: Date | null,
  excludePlanId?: string,
): {
  items: MyHardCommitment[];
  findOverlap: (start: Date, end: Date) => MyHardCommitment | null;
} {
  const [items, setItems] = useState<MyHardCommitment[]>([]);

  // ISO strings stabilise the effect key — Date objects fail reference
  // equality across renders even when the underlying instant is identical.
  const fromIso = fromUtc ? fromUtc.toISOString() : null;
  const toIso = toUtc ? toUtc.toISOString() : null;

  useEffect(() => {
    if (!fromIso || !toIso) return;
    let cancelled = false;
    getMyHardCommitmentsInRange(
      new Date(fromIso),
      new Date(toIso),
      excludePlanId,
    )
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        // Conflict surfaces are decorative; a fetch failure should never
        // block voting or plan-creation.
      });
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, excludePlanId]);

  const findOverlap = useCallback(
    (start: Date, end: Date) => {
      for (const it of items) {
        if (overlaps({ start, end }, { start: it.start, end: it.end })) {
          return it;
        }
      }
      return null;
    },
    [items],
  );

  return { items, findOverlap };
}
