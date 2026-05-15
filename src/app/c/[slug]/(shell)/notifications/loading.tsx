import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
      </header>
      <div className="flex flex-col gap-5 px-4 pt-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-32" />
        </div>
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-ink/10 bg-paper-card/60 p-4"
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
