"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Voter } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";

type Props = { voters: Voter[] };

const SECTIONS: { status: VoteStatus; label: string; emoji: string }[] = [
  { status: "in", label: "In", emoji: "🟢" },
  { status: "maybe", label: "Maybe", emoji: "🟡" },
  { status: "out", label: "Out", emoji: "🔴" },
];

export function VoteTally({ voters }: Props) {
  const [open, setOpen] = useState(false);
  const [focusStatus, setFocusStatus] = useState<VoteStatus | null>(null);
  const sectionRefs = useRef<Partial<Record<VoteStatus, HTMLElement | null>>>(
    {},
  );

  const grouped = useMemo(() => {
    const out: Record<VoteStatus, Voter[]> = { in: [], maybe: [], out: [] };
    for (const v of voters) out[v.status].push(v);
    for (const status of Object.keys(out) as VoteStatus[]) {
      out[status].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return out;
  }, [voters]);

  const totalVoters = voters.length;

  // When the sheet opens with a focus, scroll the matching section into view.
  useEffect(() => {
    if (!open || !focusStatus) return;
    // Wait for sheet animation to mount the content.
    const t = setTimeout(() => {
      sectionRefs.current[focusStatus]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
    return () => clearTimeout(t);
  }, [open, focusStatus]);

  function openWith(status: VoteStatus | null) {
    setFocusStatus(status);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // PlanCard wraps the upper card in a <Link>; the tally lives below
          // it, but stop propagation defensively in case future layouts nest.
          e.stopPropagation();
          openWith(null);
        }}
        aria-label={
          totalVoters > 0
            ? `View who voted (${totalVoters})`
            : "No votes yet"
        }
        className="-mx-1 flex w-full touch-manipulation items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition-colors duration-75 hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex flex-1 items-center">
          {SECTIONS.map((s, i) => (
            <span key={s.status} className="inline-flex items-center">
              {i > 0 ? <span className="px-1 opacity-50">·</span> : null}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`View ${s.label} voters (${grouped[s.status].length})`}
                onClick={(e) => {
                  e.stopPropagation();
                  openWith(s.status);
                }}
                className="inline-flex cursor-pointer items-center rounded px-1 py-0.5 active:bg-accent-foreground/10"
              >
                <span aria-hidden>{s.emoji}</span>
                <span className="ml-1 tabular-nums">
                  {grouped[s.status].length}
                </span>
              </span>
            </span>
          ))}
        </span>
        <ChevronRight className="size-4 shrink-0 opacity-50" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>Who&apos;s in?</SheetTitle>
            <SheetDescription>
              {totalVoters === 0
                ? "No votes yet."
                : `${totalVoters} ${totalVoters === 1 ? "person has" : "people have"} voted.`}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
            {SECTIONS.map((section) => {
              const list = grouped[section.status];
              const isFocused = focusStatus === section.status;
              return (
                <section
                  key={section.status}
                  ref={(el) => {
                    sectionRefs.current[section.status] = el;
                  }}
                  className={`flex scroll-mt-2 flex-col gap-2 rounded-md transition-colors ${
                    isFocused ? "bg-accent/40 px-2 py-2 -mx-2" : ""
                  }`}
                >
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span aria-hidden>{section.emoji}</span> {section.label} (
                    {list.length})
                  </h3>
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground/70">—</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {list.map((voter) => (
                        <li
                          key={voter.userId}
                          className="flex items-center gap-3 text-sm"
                        >
                          {voter.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={voter.avatarUrl}
                              alt=""
                              className="size-7 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                              {voter.displayName.slice(0, 1)}
                            </span>
                          )}
                          <span className="truncate">{voter.displayName}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
