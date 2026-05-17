"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ConflictCompareSheet,
} from "./conflict-compare-sheet";
import type { CompareSheetData } from "@/lib/actions/conflicts";

// Plan-detail mount point for the compare sheet. When the page is reached
// with a `?conflictWith=<otherPlanId>` query param (as set by the
// `plan_conflict` push notification), this component opens the sheet on
// first paint. Closing it strips the param via `router.replace` so a
// refresh doesn't re-open the same sheet.

type Props = {
  planAId: string;
  // Server-loaded sheet data so the sheet doesn't flash a spinner on the
  // push-notification → plan-detail jump. The server fetches via
  // `getCompareSheetData` and passes the snapshot through here.
  initialData: CompareSheetData;
};

export function ConflictCompareLauncher({ planAId, initialData }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conflictWithParam = searchParams?.get("conflictWith") ?? null;

  // We open whenever the URL says we should. After the URL is cleared,
  // `open` follows back to false on the next render — and the sheet's own
  // exit animation runs.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(Boolean(conflictWithParam));
  }, [conflictWithParam]);

  const planBId = initialData.b.planId;
  // Sanity guard: if the server sent us a different `b` than the URL
  // requested, prefer the URL — re-fetch will run on first open.
  const requestedB =
    conflictWithParam && conflictWithParam !== planBId
      ? conflictWithParam
      : planBId;

  return (
    <ConflictCompareSheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && conflictWithParam) {
          // Strip the param so the sheet doesn't auto-reopen on back/refresh.
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.delete("conflictWith");
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }
      }}
      planAId={planAId}
      planBId={requestedB}
      initialData={requestedB === planBId ? initialData : null}
    />
  );
}
