import {
  Coffee,
  Gamepad2,
  Home,
  Sparkles,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanType } from "@/lib/validation/plan";
import { PlanTime } from "./plan-time";

const TYPE_ICON: Record<PlanType, LucideIcon> = {
  eat: UtensilsCrossed,
  play: Gamepad2,
  chai: Coffee,
  "stay-in": Home,
  other: Sparkles,
};

const TYPE_LABEL: Record<PlanType, string> = {
  eat: "Eat",
  play: "Play",
  chai: "Chai",
  "stay-in": "Stay in",
  other: "Other",
};

export function PlanTypeIcon({
  type,
  className,
}: {
  type: PlanType;
  className?: string;
}) {
  const Icon = TYPE_ICON[type];
  return <Icon className={cn("size-4 text-muted-foreground", className)} aria-hidden />;
}

export function planTypeLabel(type: PlanType): string {
  return TYPE_LABEL[type];
}

export function PlanMeta({
  type,
  startsAt,
  isApproximate,
  location,
  className,
}: {
  type: PlanType;
  startsAt: Date | string;
  isApproximate: boolean;
  location: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <PlanTypeIcon type={type} />
        <PlanTime startsAt={startsAt} isApproximate={isApproximate} />
      </span>
      {location ? (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{location}</span>
        </>
      ) : null}
    </div>
  );
}
