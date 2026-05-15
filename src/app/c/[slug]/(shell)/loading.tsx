import { Skeleton } from "@/components/ui/skeleton";

// Rendered by Next while the home page's server data is in flight. Matches
// the visual rhythm of page.tsx (date row → hero → featured card → upcoming
// strip) so the layout doesn't shift when the real content streams in.
export default function CircleHomeLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
      </header>

      <div className="flex flex-col gap-4 px-4 pt-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-6 lg:order-1">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>

          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-paper-card/60 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-9 flex-1 rounded-lg" />
              <Skeleton className="h-9 flex-1 rounded-lg" />
              <Skeleton className="h-9 flex-1 rounded-lg" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <div className="flex gap-2 overflow-hidden">
              <Skeleton className="h-20 w-40 shrink-0 rounded-xl" />
              <Skeleton className="h-20 w-40 shrink-0 rounded-xl" />
              <Skeleton className="h-20 w-40 shrink-0 rounded-xl" />
            </div>
          </div>
        </div>

        <aside className="hidden flex-col gap-4 lg:order-2 lg:flex">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </aside>
      </div>
    </main>
  );
}
