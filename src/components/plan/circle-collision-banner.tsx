import { AlertTriangle } from "lucide-react";
import { CompareSheetTrigger } from "./conflict-compare-sheet";

// M32.8 §4.6 — slim banner above the upcoming strip on `/c/[slug]` home.
// Surfaces when two of the viewer's hard commitments in this circle overlap.
// Tap → side-by-side compare sheet for the pair. One banner per page —
// even if three plans collide pairwise, we surface the first pair and let
// the user resolve them one at a time.

export function CircleCollisionBanner({
  planAId,
  planBId,
}: {
  planAId: string;
  planBId: string;
}) {
  return (
    <CompareSheetTrigger
      planAId={planAId}
      planBId={planBId}
      ariaLabel="Two plans overlap — compare them"
      className="flex w-full items-center gap-2 rounded-2xl border border-coral/30 bg-coral-soft/40 px-4 py-2.5 text-left transition-colors hover:bg-coral-soft/60"
    >
      <AlertTriangle className="size-4 shrink-0 text-coral" aria-hidden />
      <span className="flex-1 text-sm text-ink">
        Two plans overlap here — heads up.
      </span>
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-coral">
        Compare
      </span>
    </CompareSheetTrigger>
  );
}
