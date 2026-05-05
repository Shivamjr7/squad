"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createPlan } from "@/lib/actions/plans";
import {
  createPlanSchema,
  type CreatePlanInput,
  type PlanTimeMode,
} from "@/lib/validation/plan";
import { getBrowserTimeZone } from "@/lib/tz";

type DecideByPreset = "1h" | "2h" | "4h" | "tonight" | "tomorrow" | "none";

type FormValues = {
  title: string;
  startsAtLocal: string;
  timeMode: PlanTimeMode;
  decidePreset: DecideByPreset;
  location: string;
  extraLocations: string[];
};

export type FormMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Default plan time: today at 8pm if it's before 7pm right now, otherwise
// tomorrow at 8pm. Keeps the hero token reading "tonight" most of the time
// while still showing the squad something they can act on tomorrow when
// it's already late.
function defaultStartsAt(now: Date): Date {
  const d = new Date(now);
  if (now.getHours() >= 19) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(20, 0, 0, 0);
  return d;
}

// Day-of-week token in the hero. Sat/Sun → "this weekend"; today + evening
// → "tonight"; today daytime → "today"; future weekday → that weekday name.
function heroToken(startsAt: Date | null, now: Date): string {
  if (!startsAt) return "tonight";
  const isWeekend = startsAt.getDay() === 0 || startsAt.getDay() === 6;
  const sameDay =
    startsAt.getFullYear() === now.getFullYear() &&
    startsAt.getMonth() === now.getMonth() &&
    startsAt.getDate() === now.getDate();
  if (isWeekend) return "this weekend";
  if (sameDay) return startsAt.getHours() >= 17 ? "tonight" : "today";
  return "today";
}

function decideBySubhead(
  preset: DecideByPreset,
  computed: Date | null,
  now: Date,
): string {
  switch (preset) {
    case "1h":
      return "The squad has 1 hour to decide.";
    case "2h":
      return "The squad has 2 hours to decide.";
    case "4h":
      return "The squad has 4 hours to decide.";
    case "tonight":
      return "Decide by tonight.";
    case "tomorrow":
      return "Decide by tomorrow.";
    case "none":
    default: {
      if (!computed) return "No deadline set.";
      const diffMs = computed.getTime() - now.getTime();
      const hours = Math.max(1, Math.round(diffMs / 3_600_000));
      return `The squad has ${hours} hour${hours === 1 ? "" : "s"} to decide.`;
    }
  }
}

// Resolve a decide-by preset to a concrete Date relative to startsAt + now.
// Returns null when the preset is "none" or when the computed value would
// be at/after the start time (server validation rejects that anyway).
function computeDecideBy(
  preset: DecideByPreset,
  startsAt: Date | null,
  now: Date,
): Date | null {
  if (!startsAt || preset === "none") return null;
  let candidate: Date;
  switch (preset) {
    case "1h":
      candidate = new Date(startsAt.getTime() - 60 * 60_000);
      break;
    case "2h":
      candidate = new Date(startsAt.getTime() - 120 * 60_000);
      break;
    case "4h":
      candidate = new Date(startsAt.getTime() - 240 * 60_000);
      break;
    case "tonight": {
      const t = new Date(now);
      t.setHours(21, 0, 0, 0);
      candidate = t;
      break;
    }
    case "tomorrow": {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      t.setHours(9, 0, 0, 0);
      candidate = t;
      break;
    }
  }
  if (candidate.getTime() <= now.getTime()) return null;
  if (candidate.getTime() >= startsAt.getTime()) return null;
  return candidate;
}

const PRESETS: { value: DecideByPreset; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "2h", label: "2h" },
  { value: "4h", label: "4h" },
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
];

export function NewPlanForm({
  circleId,
  slug,
  members,
  currentUserId,
  onDone,
}: {
  circleId: string;
  slug: string;
  members: FormMember[];
  currentUserId: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // `now` is captured once per mount so the hero token + chip math don't
  // jitter across re-renders. Acceptable staleness for a short-lived sheet.
  const now = useMemo(() => new Date(), []);

  const form = useForm<FormValues>({
    defaultValues: {
      title: "",
      startsAtLocal: toDateTimeLocal(defaultStartsAt(now)),
      timeMode: "exact",
      decidePreset: "2h",
      location: "",
      extraLocations: [],
    },
    mode: "onChange",
  });

  const title = form.watch("title");
  const startsAtLocal = form.watch("startsAtLocal");
  const timeMode = form.watch("timeMode");
  const decidePreset = form.watch("decidePreset");
  const extraLocations = form.watch("extraLocations");

  const startsAt = fromDateTimeLocal(startsAtLocal);
  const decideBy = computeDecideBy(decidePreset, startsAt, now);
  const token = heroToken(startsAt, now);
  const subhead = decideBySubhead(decidePreset, decideBy, now);

  const isTitleValid = title.trim().length >= 3;
  const isWhenValid = startsAt !== null && startsAt.getTime() > now.getTime();
  const canSubmit = isTitleValid && isWhenValid && !pending;

  // Recipients chip selection — purely visual in M19. Schema lands in M23.
  // Default state: all members selected; tapping a chip toggles them off.
  const [recipientsExpanded, setRecipientsExpanded] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const selectedCount = members.length - excluded.size;
  const allSelected = excluded.size === 0;

  function toggleRecipient(userId: string) {
    if (userId === currentUserId) return; // creator is always in
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function onSubmit(values: FormValues) {
    if (!canSubmit) return;

    const decideByLocal = decideBy ? toDateTimeLocal(decideBy) : null;

    const input: CreatePlanInput = {
      circleId,
      title: values.title,
      type: "other",
      timeMode: values.timeMode,
      startsAtLocal: values.startsAtLocal,
      timeZone: getBrowserTimeZone(),
      isApproximate: false,
      decideByLocal,
      location: values.location.trim() || null,
      extraVenues: values.extraLocations
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
      maxPeople: null,
    };

    const parsed = createPlanSchema.safeParse(input);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    startTransition(async () => {
      try {
        await createPlan(parsed.data);
        toast.success("Plan created");
        onDone?.();
        router.push(`/c/${slug}`);
        router.refresh();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not create plan.";
        toast.error(msg);
      }
    });
  }

  // Watch presets fall out of validity (e.g. user pulls the start time
  // closer than 4h from now while "4h" is selected). We don't auto-switch;
  // we just let the chip render disabled and the subhead reflect "none".
  // This keeps the UX honest about why the deadline isn't set.

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex h-full flex-col bg-paper"
      >
        {/* Header — Cancel · NEW PLAN · Send */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-paper/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
          <button
            type="button"
            onClick={onDone}
            className="text-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            Cancel
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
            New plan
          </span>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
              canSubmit ? "text-coral" : "cursor-not-allowed text-ink-muted/60",
            )}
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-md flex-col gap-7 px-5 pt-7 pb-12">
            <div className="flex flex-col gap-2">
              <h1 className="font-serif text-[34px] leading-[1.05] font-semibold text-ink">
                Anyone free{" "}
                <em className="font-instrument-serif text-[38px] italic font-normal text-coral">
                  {token}
                </em>
                ?
              </h1>
              <p className="text-sm text-ink-muted">{subhead}</p>
            </div>

            {/* WHAT */}
            <FormField
              control={form.control}
              name="title"
              rules={{
                required: "What's the plan?",
                minLength: { value: 3, message: "At least 3 characters" },
                maxLength: { value: 100, message: "Keep it under 100" },
              }}
              render={({ field }) => (
                <FormItem className="flex flex-col gap-2">
                  <CapsLabel>What</CapsLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="dinner at Karan's"
                      autoComplete="off"
                      maxLength={100}
                      className="h-11 border-0 border-b border-ink/15 bg-transparent px-0 text-lg shadow-none focus-visible:border-coral focus-visible:ring-0"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* WHEN — segmented control */}
            <div className="flex flex-col gap-2">
              <CapsLabel>When</CapsLabel>
              <div
                role="tablist"
                aria-label="Time mode"
                className="grid grid-cols-2 rounded-full border border-ink/10 bg-paper-card/60 p-1"
              >
                <SegmentButton
                  active={timeMode === "exact"}
                  onClick={() => form.setValue("timeMode", "exact")}
                >
                  Exact time
                </SegmentButton>
                <SegmentButton
                  active={timeMode === "open"}
                  onClick={() => form.setValue("timeMode", "open")}
                >
                  Open · squad picks
                </SegmentButton>
              </div>
              {timeMode === "open" ? (
                <p className="text-xs text-ink-muted">
                  The squad will vote on the hour. Time-slot voting ships in
                  the next update — for now, this still locks at the time
                  below.
                </p>
              ) : null}
            </div>

            {/* WHERE */}
            <FormField
              control={form.control}
              name="location"
              rules={{
                maxLength: { value: 100, message: "Keep it under 100" },
              }}
              render={({ field }) => (
                <FormItem className="flex flex-col gap-2">
                  <CapsLabel>Where</CapsLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Karan's place, Jubilee Hills"
                      autoComplete="off"
                      maxLength={100}
                      className="h-11 border-0 border-b border-ink/15 bg-transparent px-0 text-base shadow-none focus-visible:border-coral focus-visible:ring-0"
                    />
                  </FormControl>
                  {extraLocations.map((value, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={value}
                        onChange={(e) => {
                          const next = [...extraLocations];
                          next[idx] = e.target.value;
                          form.setValue("extraLocations", next, {
                            shouldDirty: true,
                          });
                        }}
                        placeholder={`Option ${idx + 2}`}
                        autoComplete="off"
                        maxLength={100}
                        className="h-11 flex-1 border-0 border-b border-ink/15 bg-transparent px-0 text-base shadow-none focus-visible:border-coral focus-visible:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = extraLocations.filter(
                            (_, i) => i !== idx,
                          );
                          form.setValue("extraLocations", next, {
                            shouldDirty: true,
                          });
                        }}
                        className="text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                        aria-label={`Remove option ${idx + 2}`}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue(
                        "extraLocations",
                        [...extraLocations, ""],
                        { shouldDirty: true },
                      );
                    }}
                    className="self-start text-xs font-medium text-coral transition-colors hover:text-coral/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                  >
                    + Add another option
                  </button>
                  {extraLocations.length > 0 ? (
                    <p className="text-[11px] text-ink-muted">
                      Squad will vote on the venue.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* TIME */}
            <FormField
              control={form.control}
              name="startsAtLocal"
              rules={{ required: "Pick a date and time" }}
              render={({ field }) => (
                <FormItem className="flex flex-col gap-3">
                  <CapsLabel>Time</CapsLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="datetime-local"
                      className="h-11 border-0 border-b border-ink/15 bg-transparent px-0 text-base shadow-none focus-visible:border-coral focus-visible:ring-0 [appearance:none]"
                    />
                  </FormControl>

                  <div className="flex flex-col gap-2 pt-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                      Decide by
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.map((p) => {
                        const candidate = computeDecideBy(p.value, startsAt, now);
                        const isInvalid = !candidate;
                        const isActive = decidePreset === p.value && !isInvalid;
                        return (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() => {
                              if (isInvalid) return;
                              form.setValue("decidePreset", p.value, {
                                shouldDirty: true,
                              });
                            }}
                            disabled={isInvalid}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                              isActive
                                ? "border-ink bg-ink text-paper-card"
                                : "border-ink/15 bg-paper-card/40 text-ink hover:bg-paper-card",
                              isInvalid &&
                                "cursor-not-allowed opacity-40 hover:bg-paper-card/40",
                            )}
                            aria-pressed={isActive}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          form.setValue("decidePreset", "none", {
                            shouldDirty: true,
                          })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          decidePreset === "none"
                            ? "border-ink bg-ink text-paper-card"
                            : "border-ink/15 bg-paper-card/40 text-ink-muted hover:bg-paper-card",
                        )}
                        aria-pressed={decidePreset === "none"}
                      >
                        No deadline
                      </button>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Recipients */}
            <div className="flex flex-col gap-2">
              <CapsLabel>Who</CapsLabel>
              <button
                type="button"
                onClick={() => setRecipientsExpanded((v) => !v)}
                className="self-start rounded-full border border-ink/15 bg-paper-card/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                aria-expanded={recipientsExpanded}
              >
                {allSelected ? "All" : `${selectedCount} selected`}
                <span className="mx-1.5 text-ink-muted">·</span>
                {selectedCount} {selectedCount === 1 ? "person" : "people"}
              </button>
              {recipientsExpanded ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {members.map((m) => {
                    const isMe = m.userId === currentUserId;
                    const isOff = excluded.has(m.userId);
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => toggleRecipient(m.userId)}
                        disabled={isMe}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors",
                          isOff
                            ? "border-ink/15 bg-paper-card/30 text-ink-muted line-through"
                            : "border-ink/15 bg-paper-card text-ink",
                          isMe && "cursor-not-allowed",
                        )}
                      >
                        <RecipientAvatar member={m} />
                        <span className="max-w-32 truncate">{m.displayName}</span>
                        {!isMe ? (
                          isOff ? (
                            <Plus className="size-3" aria-hidden />
                          ) : (
                            <X className="size-3 text-ink-muted" aria-hidden />
                          )
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <p className="text-[11px] text-ink-muted">
                Per-plan recipients save in the next update; for now everyone
                in the circle gets the email.
              </p>
            </div>

            {/* Pink "Set a deadline" callout — only when no deadline is set */}
            {decidePreset === "none" ? (
              <div className="rounded-2xl bg-coral-soft px-4 py-4 text-coral">
                <p className="text-sm font-semibold">Set a deadline.</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Without a decide-by, plans drift. Pick a chip above so the
                  squad knows when the answer is final.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </Form>
  );
}

function CapsLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
      {children}
    </span>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "bg-ink text-paper-card"
          : "text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function RecipientAvatar({ member }: { member: FormMember }) {
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        className="size-5 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[9px] font-semibold uppercase text-ink">
      {member.displayName.slice(0, 1)}
    </span>
  );
}

