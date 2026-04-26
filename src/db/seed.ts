import { db } from "./client";
import { circles, comments, memberships, plans, users, votes } from "./schema";

// Seed values are deterministic so re-running this script is idempotent —
// every insert uses ON CONFLICT DO NOTHING and child rows reference fixed
// UUIDs so the FK targets always exist. Run with: `pnpm db:seed`.

const SEED_USER_ID = "user_3CsrfjFkDDEVyvwdAVnEbjGwaEd";

const SEED_CIRCLE_ID = "11111111-1111-1111-1111-111111111111";
const SEED_PLAN_DINNER_ID = "22222222-2222-2222-2222-222222222222";
const SEED_PLAN_CHAI_ID = "33333333-3333-3333-3333-333333333333";
const SEED_VOTE_DINNER_ID = "44444444-4444-4444-4444-444444444444";
const SEED_VOTE_CHAI_ID = "55555555-5555-5555-5555-555555555555";
const SEED_COMMENT_1_ID = "66666666-6666-6666-6666-666666666666";
const SEED_COMMENT_2_ID = "77777777-7777-7777-7777-777777777777";

function nextSaturdayAt(hour: number): Date {
  const now = new Date();
  const d = new Date(now);
  // 6 = Saturday. If today is Saturday and we're past `hour`, jump to next week.
  const daysUntil = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntil);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  console.log("Seeding squad db…");

  await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      email: "seed@example.com",
      displayName: "Seed User",
      avatarUrl: null,
    })
    .onConflictDoNothing({ target: users.id });
  console.log("  users: ensured seed user");

  await db
    .insert(circles)
    .values({
      id: SEED_CIRCLE_ID,
      slug: "test-crew",
      name: "Test Crew",
      createdBy: SEED_USER_ID,
    })
    .onConflictDoNothing({ target: circles.slug });
  console.log("  circles: ensured Test Crew");

  await db
    .insert(memberships)
    .values({
      userId: SEED_USER_ID,
      circleId: SEED_CIRCLE_ID,
      role: "admin",
    })
    .onConflictDoNothing({ target: [memberships.userId, memberships.circleId] });
  console.log("  memberships: ensured admin membership");

  await db
    .insert(plans)
    .values([
      {
        id: SEED_PLAN_DINNER_ID,
        circleId: SEED_CIRCLE_ID,
        title: "Dinner at Karan's",
        type: "eat",
        startsAt: nextSaturdayAt(20),
        isApproximate: false,
        location: "Karan's place, Jubilee Hills",
        maxPeople: 8,
        createdBy: SEED_USER_ID,
        status: "active",
      },
      {
        id: SEED_PLAN_CHAI_ID,
        circleId: SEED_CIRCLE_ID,
        title: "Morning chai",
        type: "chai",
        startsAt: tomorrowAt(8),
        isApproximate: true,
        location: "Chai Sutta Bar, Banjara Hills",
        maxPeople: null,
        createdBy: SEED_USER_ID,
        status: "active",
      },
    ])
    .onConflictDoNothing({ target: plans.id });
  console.log("  plans: ensured 2 sample plans");

  await db
    .insert(votes)
    .values([
      {
        id: SEED_VOTE_DINNER_ID,
        planId: SEED_PLAN_DINNER_ID,
        userId: SEED_USER_ID,
        status: "in",
      },
      {
        id: SEED_VOTE_CHAI_ID,
        planId: SEED_PLAN_CHAI_ID,
        userId: SEED_USER_ID,
        status: "in",
      },
    ])
    .onConflictDoNothing({ target: [votes.planId, votes.userId] });
  console.log("  votes: ensured 2 'in' votes");

  await db
    .insert(comments)
    .values([
      {
        id: SEED_COMMENT_1_ID,
        planId: SEED_PLAN_DINNER_ID,
        userId: SEED_USER_ID,
        body: "I'll bring the dessert.",
      },
      {
        id: SEED_COMMENT_2_ID,
        planId: SEED_PLAN_DINNER_ID,
        userId: SEED_USER_ID,
        body: "Parking should be fine on the street.",
      },
    ])
    .onConflictDoNothing({ target: comments.id });
  console.log("  comments: ensured 2 comments on dinner plan");

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
