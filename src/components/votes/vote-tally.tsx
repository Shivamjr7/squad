"use client";

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
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

  const grouped = useMemo(() => {
    const out: Record<VoteStatus, Voter[]> = { in: [], maybe: [], out: [] };
    for (const v of voters) out[v.status].push(v);
    for (const status of Object.keys(out) as VoteStatus[]) {
      out[status].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return out;
  }, [voters]);

  const totalVoters = voters.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="touch-manipulation self-start rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors duration-75 hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            totalVoters > 0
              ? `View who voted (${totalVoters})`
              : "No votes yet"
          }
        >
          {SECTIONS.map((s, i) => (
            <span key={s.status} className="inline-flex items-center">
              {i > 0 ? <span className="px-1 opacity-50">·</span> : null}
              <span aria-hidden>{s.emoji}</span>
              <span className="ml-1 tabular-nums">
                {grouped[s.status].length}
              </span>
            </span>
          ))}
        </button>
      </SheetTrigger>
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
            return (
              <section key={section.status} className="flex flex-col gap-2">
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
  );
}
