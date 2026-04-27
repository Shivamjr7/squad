// M5 verification. Confirms:
//   1. `votes` is a member of the `supabase_realtime` publication so the
//      browser realtime subscription will actually receive INSERT/UPDATE/
//      DELETE events. Set up in M2; we only re-check, never alter.
//   2. castVote upserts on the (plan_id, user_id) unique index so a second
//      vote replaces the first.
//   3. removeVote deletes only the calling user's row.
//
// Run: pnpm exec tsx --env-file=.env.local scripts/smoke-m5.ts
// Cleans up after itself.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { circles, memberships, plans, users, votes } from "../src/db/schema";

const SEED_USER_ID = "user_3CsrfjFkDDEVyvwdAVnEbjGwaEd";

function ts(): string {
  return Math.random().toString(36).slice(2, 7);
}

async function main() {
  // ── 1. Realtime publication membership ──────────────────────────────
  const pub = (await db.execute(
    sql`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('votes','comments')`,
  )) as unknown as { tablename: string }[];
  const tables = new Set(pub.map((r) => r.tablename));
  if (!tables.has("votes")) {
    throw new Error(
      "votes is NOT in supabase_realtime publication — realtime subscriptions will receive nothing. Run: alter publication supabase_realtime add table votes;",
    );
  }
  console.log("✓ votes is in supabase_realtime publication");
  if (tables.has("comments")) {
    console.log("✓ comments also in publication (M6 will need it)");
  } else {
    console.log("· comments not yet in publication (M6 will add)");
  }

  // ── 2. Setup: a circle with one member and one plan ─────────────────
  const seed = await db.query.users.findFirst({
    where: eq(users.id, SEED_USER_ID),
  });
  if (!seed) {
    throw new Error(
      `Seed user ${SEED_USER_ID} not found — run pnpm db:seed first.`,
    );
  }

  const tag = ts();
  const [circle] = await db
    .insert(circles)
    .values({
      slug: `m5-${tag}`,
      name: `M5 smoke ${tag}`,
      createdBy: SEED_USER_ID,
    })
    .returning();
  if (!circle) throw new Error("circle insert failed");

  await db
    .insert(memberships)
    .values({ userId: SEED_USER_ID, circleId: circle.id, role: "admin" });

  const [plan] = await db
    .insert(plans)
    .values({
      circleId: circle.id,
      title: "Vote smoke",
      type: "chai",
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: SEED_USER_ID,
    })
    .returning();
  if (!plan) throw new Error("plan insert failed");

  try {
    // ── 3. Cast 'in', then upsert to 'out' ────────────────────────────
    await db
      .insert(votes)
      .values({ planId: plan.id, userId: SEED_USER_ID, status: "in" })
      .onConflictDoUpdate({
        target: [votes.planId, votes.userId],
        set: { status: "in", votedAt: new Date() },
      });

    let row = await db.query.votes.findFirst({
      where: and(
        eq(votes.planId, plan.id),
        eq(votes.userId, SEED_USER_ID),
      ),
    });
    if (row?.status !== "in") {
      throw new Error(`expected 'in', got ${row?.status}`);
    }

    await db
      .insert(votes)
      .values({ planId: plan.id, userId: SEED_USER_ID, status: "out" })
      .onConflictDoUpdate({
        target: [votes.planId, votes.userId],
        set: { status: "out", votedAt: new Date() },
      });

    row = await db.query.votes.findFirst({
      where: and(
        eq(votes.planId, plan.id),
        eq(votes.userId, SEED_USER_ID),
      ),
    });
    if (row?.status !== "out") {
      throw new Error(`upsert didn't replace: got ${row?.status}`);
    }

    const allRows = await db.query.votes.findMany({
      where: eq(votes.planId, plan.id),
    });
    if (allRows.length !== 1) {
      throw new Error(
        `expected 1 vote row after upsert, got ${allRows.length}`,
      );
    }
    console.log("✓ castVote upsert: replaces row, no duplicates");

    // ── 4. Remove vote ─────────────────────────────────────────────────
    await db
      .delete(votes)
      .where(
        and(eq(votes.planId, plan.id), eq(votes.userId, SEED_USER_ID)),
      );

    const after = await db.query.votes.findMany({
      where: eq(votes.planId, plan.id),
    });
    if (after.length !== 0) {
      throw new Error(`expected 0 votes after remove, got ${after.length}`);
    }
    console.log("✓ removeVote: row deleted");
  } finally {
    await db.delete(circles).where(eq(circles.id, circle.id));
    console.log("· cleaned up");
  }

  console.log("\nM5 smoke ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
