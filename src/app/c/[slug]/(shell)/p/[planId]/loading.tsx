import { Skeleton } from "@/components/ui/skeleton";

export default function PlanDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 pt-3 pb-32 sm:px-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Skeleton className="-ml-2 size-9 shrink-0 rounded-md" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32 rounded-full" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-paper-card/60 p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-lg" />
          <Skeleton className="h-11 flex-1 rounded-lg" />
          <Skeleton className="h-11 flex-1 rounded-lg" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-3 py-2"
            >
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-12" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
