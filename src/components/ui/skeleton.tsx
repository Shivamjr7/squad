import { cn } from "@/lib/utils";

// Single primitive — a paper-toned pulsing block. Compose with width/height/
// shape utilities at the call site. Kept dependency-free so loading.tsx files
// can render as server components without paying for a hydration boundary.
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-ink/10", className)}
      {...props}
    />
  );
}
