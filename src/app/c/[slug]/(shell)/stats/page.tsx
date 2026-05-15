import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db/client";
import { circles, memberships } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireDisplayNameSet } from "@/lib/auth";
import { getSuggestStats } from "@/lib/suggest/stats";

// S8 — admin-only stats page (M27 will extend with other dashboards).
// Single Suggestions section for now; adoption metrics derived per the
// 11-observability.md spec.

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 7;

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurants",
  cafe: "Cafés",
  movie: "Movies",
  event: "Events",
  indoor: "Indoor",
  outdoor: "Outdoor",
  short_trip: "Short trips",
};

function pct(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

export default async function CircleStatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const membership = await db.query.memberships.findFirst({
    columns: { role: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.circleId, circle.id),
    ),
  });
  if (!membership) notFound();
  if (membership.role !== "admin") redirect(`/c/${circle.slug}`);

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const stats = await getSuggestStats({ circleId: circle.id, since });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-4 py-6 pb-32 sm:px-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0"
            aria-label="Back to circle"
          >
            <Link href={`/c/${circle.slug}`}>
              <ArrowLeft />
            </Link>
          </Button>
          <span className="truncate text-sm font-medium">{circle.name}</span>
        </div>
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          Stats
        </span>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Suggestions</h2>
          <span className="text-xs text-muted-foreground">
            Last {WINDOW_DAYS} days
          </span>
        </div>

        {stats.impressions === 0 && stats.totalLogs === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No Suggest activity yet in this window.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile
                label="Impressions"
                value={stats.impressions.toLocaleString()}
                hint={`${stats.totalLogs} fetches`}
              />
              <StatTile
                label="Acceptance"
                value={pct(stats.acceptanceRate)}
                hint={`${stats.feedback.add} adds`}
              />
              <StatTile
                label="Rejected"
                value={pct(stats.rejectRate)}
                hint={`${stats.feedback.reject} rejects`}
              />
              <StatTile
                label="Won"
                value={pct(stats.wonRate)}
                hint={`${stats.feedback.won} of ${stats.feedback.add}`}
              />
              <StatTile
                label="Low-confidence"
                value={pct(stats.lowConfidenceFallbackRate)}
                hint="of impressions"
              />
              <StatTile
                label="Empty result"
                value={pct(stats.emptyRate)}
                hint={`${stats.outcomes.empty} of ${stats.totalLogs}`}
              />
            </ul>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Top categories
                </h3>
                {stats.topCategories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing surfaced yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {stats.topCategories.map((c) => (
                      <li
                        key={c.category}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.impressions} · {c.adds} adds
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-md border p-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Degraded providers
                </h3>
                {stats.degradedByProvider.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    All providers healthy.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {stats.degradedByProvider.map((d) => (
                      <li
                        key={d.provider}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate font-mono text-xs">
                          {d.provider}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {d.count} fetches
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <li className="flex flex-col gap-0.5 rounded-md border p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-serif text-2xl leading-tight">{value}</span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </li>
  );
}
