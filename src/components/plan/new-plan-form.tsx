"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Coffee, Gamepad2, Home, Sparkles, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createPlan } from "@/lib/actions/plans";
import {
  createPlanSchema,
  type CreatePlanInput,
  type PlanType,
} from "@/lib/validation/plan";
import { getBrowserTimeZone } from "@/lib/tz";

const TYPE_OPTIONS: { value: PlanType; label: string; Icon: typeof Coffee }[] = [
  { value: "eat", label: "Eat", Icon: UtensilsCrossed },
  { value: "play", label: "Play", Icon: Gamepad2 },
  { value: "chai", label: "Chai", Icon: Coffee },
  { value: "stay-in", label: "Stay in", Icon: Home },
  { value: "other", label: "Other", Icon: Sparkles },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Default to next Saturday at 8pm in the viewer's local zone, formatted for
// <input type="datetime-local">. If today is Saturday, jumps to next week.
function nextSaturday8pm(now: Date): string {
  const d = new Date(now);
  const dow = d.getDay();
  const daysUntilSat = (6 - dow + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSat);
  d.setHours(20, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormValues = {
  title: string;
  type: PlanType;
  startsAtLocal: string;
  isApproximate: boolean;
  decideByLocal: string;
  location: string;
  maxPeople: string; // string for input; coerced to number on submit
};

export function NewPlanForm({
  circleId,
  slug,
  onDone,
}: {
  circleId: string;
  slug: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    defaultValues: {
      title: "",
      type: "eat",
      startsAtLocal: nextSaturday8pm(new Date()),
      isApproximate: false,
      decideByLocal: "",
      location: "",
      maxPeople: "",
    },
    mode: "onTouched",
  });

  const selectedType = form.watch("type");
  const isApproximate = form.watch("isApproximate");

  function onSubmit(values: FormValues) {
    const maxPeopleNum = values.maxPeople.trim()
      ? Number.parseInt(values.maxPeople, 10)
      : null;

    const input: CreatePlanInput = {
      circleId,
      title: values.title,
      type: values.type,
      startsAtLocal: values.startsAtLocal,
      timeZone: getBrowserTimeZone(),
      isApproximate: values.isApproximate,
      decideByLocal: values.decideByLocal || null,
      location: values.location.trim() || null,
      maxPeople: Number.isFinite(maxPeopleNum) ? maxPeopleNum : null,
    };

    const parsed = createPlanSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(issue?.message ?? "Please check the form.");
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
        const msg = err instanceof Error ? err.message : "Could not create plan.";
        toast.error(msg);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-5 px-4 pb-6 sm:px-0"
      >
        <FormField
          control={form.control}
          name="title"
          rules={{
            required: "What's the plan?",
            minLength: { value: 3, message: "At least 3 characters" },
            maxLength: { value: 100, message: "Keep it under 100" },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>What&apos;s the plan?</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Saturday dinner at Karan's"
                  autoFocus
                  autoComplete="off"
                  maxLength={100}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-2">
          <Label>Type</Label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => form.setValue("type", value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  selectedType === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-input bg-background hover:bg-accent",
                )}
                aria-pressed={selectedType === value}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <FormField
          control={form.control}
          name="startsAtLocal"
          rules={{ required: "Pick a date and time" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>When</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="datetime-local"
                  className="appearance-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isApproximate"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 rounded-md border p-3">
              <FormControl>
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="mt-0.5 size-4 accent-foreground"
                />
              </FormControl>
              <div className="flex flex-col gap-0.5">
                <FormLabel className="cursor-pointer font-normal">
                  I just know roughly when
                </FormLabel>
                <FormDescription className="text-xs">
                  {isApproximate
                    ? "Friends will see a rough time, not the exact one."
                    : "Friends will see the exact time you picked."}
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="decideByLocal"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Decide by{" "}
                <span className="text-xs text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="datetime-local"
                  className="appearance-none"
                />
              </FormControl>
              <FormDescription className="text-xs">
                When do you need an answer by?
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="location"
          rules={{ maxLength: { value: 100, message: "Keep it under 100" } }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Where <span className="text-xs text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Karan's place, Jubilee Hills"
                  autoComplete="off"
                  maxLength={100}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="maxPeople"
          rules={{
            pattern: {
              value: /^\d*$/,
              message: "Numbers only",
            },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Max people{" "}
                <span className="text-xs text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode="numeric"
                  pattern="\d*"
                  placeholder="8"
                  autoComplete="off"
                  maxLength={4}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="mt-2 h-12 w-full text-base"
          disabled={pending}
        >
          {pending ? "Creating…" : "Create plan"}
        </Button>
      </form>
    </Form>
  );
}
