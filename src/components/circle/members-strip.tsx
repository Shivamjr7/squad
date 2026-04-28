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
        className="flex w-full touch-manipulation items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-75 hover:bg-accent/50 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex -space-x-2">
          {shown.map((m) => (
            <Avatar key={m.userId} member={m} />
          ))}
          {overflow > 0 ? (
            <span className="z-10 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium tabular-nums text-muted-foreground">
              +{overflow}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "member" : "members"}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>Members</SheetTitle>
            <SheetDescription>
              {total} {total === 1 ? "person is" : "people are"} in this circle.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1 overflow-y-auto px-4 pb-6">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-3 rounded-md px-2 py-2"
              >
                <Avatar member={m} size="lg" />
                <span className="flex-1 truncate text-sm">{m.displayName}</span>
                {m.role === "admin" ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    admin
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
  const ring =
    size === "sm" ? "border-2 border-background" : "";
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
      className={`${dim} ${ring} flex items-center justify-center rounded-full bg-muted ${text} font-medium uppercase`}
    >
      {member.displayName.slice(0, 1)}
    </span>
  );
}
