"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { proposeTime } from "@/lib/actions/plan-time-proposals";
import { getBrowserTimeZone } from "@/lib/tz";
import { cn } from "@/lib/utils";

type Tone = "light" | "dark";

type Props = {
  planId: string;
  // Default starting time for the picker — typically the canonical plan time
  // so "+90 min" feels like a natural after-plan add-on offset.
  defaultStartsAt: Date;
  tone?: Tone;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// M24 — inline composer for the PLUS row (live ticker) and AFTER row
// (receipt). Submitting writes a plan_time_proposals row with kind=addition,
// label=<text>. The row renders as a stacked sub-plan, NOT a vote candidate
// for the canonical time slot.
export function SuggestAddition({
  planId,
  defaultStartsAt,
  tone = "light",
}: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(() => {
    const d = new Date(defaultStartsAt.getTime() + 90 * 60_000);
    return toDateTimeLocal(d);
  });
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      toast.error("Add a short label, like 'Dinner after at Bar Tartine'.");
      return;
    }
    startTransition(async () => {
      try {
        await proposeTime({
          planId,
          startsAtLocal,
          timeZone: getBrowserTimeZone(),
          kind: "addition",
          label: trimmed,
        });
        toast.success("Add-on suggested");
        setLabel("");
        setOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add suggestion.",
        );
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
          tone === "dark"
            ? "border-white/20 text-white/70 hover:bg-white/5"
            : "border-ink/20 text-ink-muted hover:bg-paper-card/60",
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        Suggest add-on
      </button>
    );
  }

  const inputClass = cn(
    "h-10 border-0 border-b bg-transparent px-0 text-sm shadow-none focus-visible:border-coral focus-visible:ring-0",
    tone === "dark"
      ? "border-white/20 text-white placeholder:text-white/40"
      : "border-ink/15 text-ink",
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        tone === "dark"
          ? "border-white/10 bg-white/[0.04]"
          : "border-ink/10 bg-paper-card/40",
      )}
    >
      <Input
        autoFocus
        placeholder="Dinner after at Bar Tartine"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={100}
        className={inputClass}
      />
      <Input
        type="datetime-local"
        value={startsAtLocal}
        onChange={(e) => setStartsAtLocal(e.target.value)}
        className={cn(inputClass, "[appearance:none]")}
      />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setLabel("");
          }}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            tone === "dark"
              ? "text-white/60 hover:bg-white/5"
              : "text-ink-muted hover:bg-paper-card/60",
          )}
        >
          Cancel
        </button>
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={pending}
          className="rounded-full"
        >
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
