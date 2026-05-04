"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type StripMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "member";
};

const VISIBLE = 5;

export function MembersStrip({ members }: { members: StripMember[] }) {
  const [open, setOpen] = useState(false);

  const total = members.length;
  const shown = members.slice(0, VISIBLE);
  const overflow = Math.max(0, total - VISIBLE);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View all ${total} members`}
        className="flex w-full touch-manipulation items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-75 hover:bg-paper-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        <div className="flex -space-x-2">
          {shown.map((m) => (
            <Avatar key={m.userId} member={m} />
          ))}
          {overflow > 0 ? (
            <span className="z-10 flex size-7 items-center justify-center rounded-full bg-ink/10 text-[10px] font-medium tabular-nums text-ink-muted ring-2 ring-paper">
              +{overflow}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-ink-muted">
          {total} {total === 1 ? "member" : "members"}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="bg-paper sm:max-w-sm"
        >
          <SheetHeader className="border-b border-ink/10 px-5 pt-5 pb-4">
            <SheetTitle className="font-serif text-2xl font-semibold text-ink">
              Members
            </SheetTitle>
            <SheetDescription className="text-xs uppercase tracking-[0.12em] text-ink-muted">
              {total} {total === 1 ? "person" : "people"}
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-6">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-3 rounded-md px-3 py-2.5"
              >
                <Avatar member={m} size="lg" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {m.displayName}
                </span>
                {m.role === "admin" ? (
                  <span className="shrink-0 rounded-full bg-paper-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                    Admin
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Avatar({
  member,
  size = "sm",
}: {
  member: StripMember;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "size-9" : "size-7";
  const text = size === "lg" ? "text-sm" : "text-[10px]";
  const ring = size === "sm" ? "ring-2 ring-paper" : "";
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        className={`${dim} ${ring} rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dim} ${ring} flex items-center justify-center rounded-full bg-ink/10 ${text} font-medium uppercase text-ink`}
    >
      {member.displayName.slice(0, 1)}
    </span>
  );
}
