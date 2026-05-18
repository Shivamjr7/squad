import { HeroQuestion } from "@/components/ui/hero-question";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="eyebrow text-ink-muted">
        Offline
      </span>
      <HeroQuestion
        prefix="No signal,"
        accent="yet"
        suffix="."
        size="lg"
      />
      <p className="text-sm text-ink-muted">
        Squad needs the network to show the latest plans. Try again once
        you&rsquo;re back online.
      </p>
    </main>
  );
}
