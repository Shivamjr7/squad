import { Skeleton } from "@/components/ui/skeleton";

export default function YouLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
      </header>
      <div className="flex flex-col gap-6 px-4 pt-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-ink/10 bg-paper-card/60 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-paper-card/60 p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-12 rounded-full" />
        </div>
      </div>
    </main>
  );
}
