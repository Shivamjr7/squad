// M4 data-layer smoke test. Verifies:
//   1. zonedWallClockToUtc converts wall clock + IANA zone to correct UTC
//   2. Plan insert + creator auto-vote in a single transaction
//   3. Round-trip of timestamps (what we sent is what Postgres stored)
//   4. Approximate-time and past-time plans store cleanly
//
// Run: pnpm exec tsx --env-file=.env.local scripts/smoke-m4.ts
// Cleans up after itself.

import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { circles, memberships, plans, users, votes } from "../src/db/schema";
import { isValidTimeZone, zonedWallClockToUtc } from "../src/lib/tz";

const SEED_USER_ID = "user_3CsrfjFkDDEVyvwdAVnEbjGwaEd";

function ts(): string {
  return Math.random().toString(36).slice(2, 7);
}

async function main() {
  // ── 0. Standalone tz helper checks ──────────────────────────────────
  if (!isValidTimeZone("Asia/Kolkata")) throw new Error("IST not valid?");
  if (isValidTimeZone("Foo/Bar")) throw new Error("garbage zone accepted");

  // IST is fixed UTC+5:30, no DST — easiest to reason about.
  // 2026-05-02 20:00 IST should be 2026-05-02 14:30:00 UTC.
  const ist = zonedWallClockToUtc("2026-05-02T20:00", "Asia/Kolkata");
  if (ist.toISOString() !== "2026-05-02T14:30:00.000Z") {
    throw new Error(`IST conversion wrong: ${ist.toISOString()}`);
  }
  console.log(`  ✓ tz: 2026-05-02 20:00 IST → ${ist.toISOString()}`);

  // UTC zone should pass straight through.
  const utc = zonedWallClockToUtc("2026-05-02T20:00", "UTC");
  if (utc.toISOString() !== "2026-05-02T20:00:00.000Z") {
    throw new Error(`UTC conversion wrong: ${utc.toISOString()}`);
  }
  console.log(`  ✓ tz: 2026-05-02 20:00 UTC → ${utc.toISOString()}`);

  // America/Los_Angeles is UTC-7 in May (DST). 20:00 PT → 03:00 UTC next day.
  const la = zonedWallClockToUtc("2026-05-02T20:00", "America/Los_Angeles");
  if (la.toISOString() !== "2026-05-03T03:00:00.000Z") {
    throw new Error(`LA conversion wrong: ${la.toISOString()}`);
  }
  console.log(`  ✓ tz: 2026-05-02 20:00 PT (DST) → ${la.toISOString()}`);

  // ── 1. Setup: ensure seed user + a temp circle ──────────────────────
  await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      email: "smoke@example.com",
      displayName: "Smoke User",
    })
    .onConflictDoNothing({ target: users.id });

  const SMOKE_SLUG = `m4-smoke-${ts()}`;
  const [circle] = await db
    .insert(circles)
    .values({ slug: SMOKE_SLUG, name: "M4 Smoke", createdBy: SEED_USER_ID })
    .returning({ id: circles.id });
  if (!circle) throw new Error("circle insert failed");
  await db.insert(memberships).values({
    userId: SEED_USER_ID,
    circleId: circle.id,
    role: "admin",
  });
  console.log(`  ✓ temp circle created (id=${circle.id})`);

  // ── 2. Three plans of distinct shapes ───────────────────────────────
  const futureExact = zonedWallClockToUtc("2026-05-02T20:00", "Asia/Kolkata");
  const futureApprox = zonedWallClockToUtc("2026-05-03T12:00", "Asia/Kolkata");
  const pastExact = new Date(Date.now() - 7 * 86400000); // a week ago

  const inserted = await db.transaction(async (tx) => {
    const [p1] = await tx
      .insert(plans)
      .values({
        circleId: circle.id,
        title: "Saturday dinner",
        type: "eat",
        startsAt: futureExact,
        isApproximate: false,
        location: "Karan's place",
        maxPeople: 8,
        createdBy: SEED_USER_ID,
        status: "active",
      })
      .returning({ id: plans.id, startsAt: plans.startsAt });

    const [p2] = await tx
      .insert(plans)
      .values({
        circleId: circle.id,
        title: "Chai this weekend",
        type: "chai",
        startsAt: futureApprox,
        isApproximate: true,
        location: null,
        maxPeople: null,
        createdBy: SEED_USER_ID,
        status: "active",
      })
      .returning({ id: plans.id, startsAt: plans.startsAt });

    const [p3] = await tx
      .insert(plans)
      .values({
        circleId: circle.id,
        title: "Last week's movie",
        type: "play",
        startsAt: pastExact,
        isApproximate: false,
        location: "PVR",
        maxPeople: 6,
        createdBy: SEED_USER_ID,
        status: "active",
      })
      .returning({ id: plans.id, startsAt: plans.startsAt });

    if (!p1 || !p2 || !p3) throw new Error("plan insert returned no row");

    for (const p of [p1, p2, p3]) {
      await tx.insert(votes).values({
        planId: p.id,
        userId: SEED_USER_ID,
        status: "in",
      });
    }
    return [p1, p2, p3] as const;
  });
  console.log(`  ✓ 3 plans inserted with creator auto-vote 'in'`);

  // ── 3. Round-trip check on the IST plan ─────────────────────────────
  const stored = inserted[0].startsAt;
  if (stored.toISOString() !== futureExact.toISOString()) {
    throw new Error(
      `round-trip mismatch: sent ${futureExact.toISOString()} got ${stored.toISOString()}`,
    );
  }
  console.log(
    `  ✓ round-trip: stored ${stored.toISOString()} (should render "Sat 8:00 PM" in IST)`,
  );

  // ── 4. Verify creator vote count = 3 ────────────────────────────────
  const voteRows = await db.query.votes.findMany({
    where: eq(votes.userId, SEED_USER_ID),
    columns: { planId: true, status: true },
  });
  const planIds = new Set(inserted.map((p) => p.id));
  const matchedVotes = voteRows.filter((v) => planIds.has(v.planId));
  if (matchedVotes.length !== 3) {
    throw new Error(`expected 3 votes, got ${matchedVotes.length}`);
  }
  if (matchedVotes.some((v) => v.status !== "in")) {
    throw new Error("auto-vote status not 'in'");
  }
  console.log("  ✓ creator auto-votes are all 'in'");

  // ── 5. Cleanup (cascades to plans + votes) ──────────────────────────
  await db.delete(circles).where(eq(circles.id, circle.id));
  console.log(`  ✓ cleaned up circle ${circle.id}`);
  console.log("✅ M4 smoke OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ M4 smoke FAILED:", err);
    process.exit(1);
  });
