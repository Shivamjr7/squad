// M3 data-layer smoke test. Exercises the same Drizzle inserts that the
// createCircle and generateInvite server actions perform, without going
// through Clerk auth (which needs a request context).
//
// Run with: pnpm exec tsx --env-file=.env.local scripts/smoke-m3.ts
//
// Cleans up after itself, so it's safe to re-run.

import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { circles, invites, memberships, users } from "../src/db/schema";
import { generateInviteCode } from "../src/lib/invite-code";
import { createCircleSchema } from "../src/lib/validation/circle";
import { isReservedSlug, slugify, RESERVED_SLUGS } from "../src/lib/slug";

const SEED_USER_ID = "user_3CsrfjFkDDEVyvwdAVnEbjGwaEd";

function ts(): string {
  return Math.random().toString(36).slice(2, 7);
}

async function main() {
  const SMOKE_SLUG = `smoke-${ts()}`;
  const SMOKE_NAME = "Smoke Crew";
  console.log(`▶ smoke: slug=${SMOKE_SLUG}`);

  // 0. Make sure the seed user exists (the webhook would normally create it).
  await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      email: "smoke@example.com",
      displayName: "Smoke User",
    })
    .onConflictDoNothing({ target: users.id });

  // 1. zod validation: well-formed input passes.
  const ok = createCircleSchema.safeParse({ name: SMOKE_NAME, slug: SMOKE_SLUG });
  if (!ok.success) throw new Error("zod rejected valid input: " + ok.error.message);
  console.log("  ✓ zod accepts well-formed input");

  // 2. Reserved slug rejection (representative sample).
  for (const r of ["onboarding", "c", "settings"]) {
    const bad = createCircleSchema.safeParse({ name: SMOKE_NAME, slug: r });
    if (bad.success) throw new Error(`reserved slug "${r}" was accepted`);
  }
  if (!RESERVED_SLUGS.includes("c"))
    throw new Error("reserved list missing 'c'");
  console.log("  ✓ reserved slugs rejected");

  // 3. Slugify behaves on messy input.
  const s = slugify("  Hyderabad Crew!! ");
  if (s !== "hyderabad-crew") throw new Error("slugify wrong: " + s);
  if (isReservedSlug("admin") !== true) throw new Error("isReservedSlug wrong");
  console.log("  ✓ slugify + isReservedSlug behave");

  // 4. Transactional insert: circle + admin membership.
  const circleId = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(circles)
      .values({ slug: SMOKE_SLUG, name: SMOKE_NAME, createdBy: SEED_USER_ID })
      .returning({ id: circles.id });
    if (!c) throw new Error("circle insert returned no row");
    await tx.insert(memberships).values({
      userId: SEED_USER_ID,
      circleId: c.id,
      role: "admin",
    });
    return c.id;
  });
  console.log(`  ✓ circle + admin membership inserted (id=${circleId})`);

  // 5. Uniqueness: duplicate slug must fail with PG 23505.
  // Drizzle wraps postgres-js errors so the real code lives on .cause.
  function pgCode(e: unknown): string | undefined {
    return (
      (e as { code?: string }).code ??
      (e as { cause?: { code?: string } }).cause?.code
    );
  }
  let dupErr: unknown = null;
  try {
    await db
      .insert(circles)
      .values({ slug: SMOKE_SLUG, name: "dup", createdBy: SEED_USER_ID });
  } catch (e) {
    dupErr = e;
  }
  if (pgCode(dupErr) !== "23505") {
    throw new Error("duplicate slug should have failed with 23505, got: " + dupErr);
  }
  console.log("  ✓ duplicate slug → PG 23505");

  // 6. Invite code generation + insert.
  const code = generateInviteCode();
  if (code.length < 12) throw new Error(`invite code too short: ${code}`);
  await db.insert(invites).values({
    circleId,
    code,
    createdBy: SEED_USER_ID,
  });
  console.log(`  ✓ invite inserted (code=${code}, len=${code.length})`);

  // 7. Idempotent membership insert (composite unique).
  let idemErr: unknown = null;
  try {
    await db.insert(memberships).values({
      userId: SEED_USER_ID,
      circleId,
      role: "member",
    });
  } catch (e) {
    idemErr = e;
  }
  if (pgCode(idemErr) !== "23505") {
    throw new Error(
      "duplicate membership should have failed with 23505, got: " + idemErr,
    );
  }
  console.log("  ✓ duplicate (user, circle) membership → PG 23505");

  // 8. Cleanup. Cascade handles invites + memberships.
  await db.delete(circles).where(eq(circles.id, circleId));
  console.log(`  ✓ cleaned up circle ${circleId}`);
  console.log("✅ smoke OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ smoke FAILED:", err);
    process.exit(1);
  });
