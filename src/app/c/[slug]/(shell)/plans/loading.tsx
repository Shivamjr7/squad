import { Skeleton } from "@/components/ui/skeleton";

export default function MyPlansLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
      </header>
      <div className="flex flex-col gap-5 px-4 pt-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-40" />
        </div>
        <ul className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-ink/10 bg-paper-card/60 p-4"
            >
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
