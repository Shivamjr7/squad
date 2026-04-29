"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Voter } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { VoterStrip } from "./voter-strip";

type Props = {
  voters: Voter[];
  density?: "card" | "detail";
};

const SECTIONS: { status: VoteStatus; label: string; emoji: string }[] = [
  { status: "in", label: "In", emoji: "🟢" },
  { status: "maybe", label: "Maybe", emoji: "🟡" },
  { status: "out", label: "Out", emoji: "🔴" },
];

export function VoteTally({ voters, density = "card" }: Props) {
  const [open, setOpen] = useState(false);
  const [focusStatus, setFocusStatus] = useState<VoteStatus | null>(null);
  const sectionRefs = useRef<Partial<Record<VoteStatus, HTMLElement | null>>>(
    {},
  );

  const grouped = useMemo(() => {
    const out: Record<VoteStatus, Voter[]> = { in: [], maybe: [], out: [] };
    for (const v of voters) out[v.status].push(v);
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

  if (totalVoters === 0) {
    return (
      <p className="px-2 text-xs text-muted-foreground">No votes yet.</p>
    );
  }

  return (
    <>
      <div className="-mx-1 flex flex-col gap-0.5">
        {SECTIONS.map((s) =>
          grouped[s.status].length > 0 ? (
            <VoterStrip
              key={s.status}
              status={s.status}
              voters={grouped[s.status]}
              density={density}
              onOpen={() => openWith(s.status)}
            />
          ) : null,
        )}
      </div>

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
              const list = [...grouped[section.status]].sort((a, b) =>
                a.displayName.localeCompare(b.displayName),
              );
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
