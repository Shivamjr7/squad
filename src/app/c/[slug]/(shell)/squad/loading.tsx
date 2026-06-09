import { Skeleton } from "@/components/ui/skeleton";

export default function SquadLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
      </header>
      <div className="flex flex-col gap-5 px-4 pt-6 sm:px-6">
        <div className="flex items-end justify-between gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-xl border border-ink/10 bg-paper-card/60 p-3"
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
