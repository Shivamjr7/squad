# PLAN.md — Squad

> Source of truth for what we're building. Claude Code reads this at the start of every session (referenced from CLAUDE.md). Anything not in here is not in scope.

## 1. Problem

Every weekend, my friend group spends way too much time on WhatsApp coordinating basic decisions:

- Are we even meeting today?
- Who's free?
- Eat out, play, or stay in for chai?
- Where?
- Final headcount?

The conversation is messy, decisions get lost in scrollback, "yes" turns into "actually no" three messages later, and someone always asks "wait, are we still on for tonight?"

This app replaces that thread with a structured surface: a plan, a vote, a clear answer.

## 2. Win condition

This project succeeds if:

- My circle uses it for **at least 5 plans in the first month** without me nagging
- After 4 weeks, **at least 60% of weekend plans** start in the app instead of WhatsApp
- I personally find it **less annoying than WhatsApp** for this — if I don't, no one else will

This project fails if it becomes "a side project I built but nobody uses." That outcome is more likely than success unless I'm honest about every scope decision below.

## 3. Non-goals (for v1)

These are explicitly NOT in v1. Do not build them even if they seem useful or "would only take an hour":

- **Calendar sync** (Google Calendar, Apple Calendar) — voting In/Out IS the calendar feature
- **Push notifications** — email is enough for v1
- **Place suggestions / restaurant database** — `location` is a free-text field, Maps handles the rest
- **Recurring plans** ("every Sunday chai") — manual creation is fine
- **Multi-circle UX** — schema supports multiple circles, UI defaults to one
- **Spending split / payment tracking**
- **Photo upload after the plan** ("memories")
- **AI suggestions** (Claude picks the restaurant, breaks vote ties, etc.)
- **iOS/Android native app** — web app, mobile-first, install as PWA if anything
- **Public discovery** — circles are invite-only, never indexed
- **Threaded comment replies** — flat thread per plan, oldest-first
- **Polls/voting beyond In/Out/Maybe** — no "vote between 3 venues" feature

When tempted to build any of the above, write it in the v2 wishlist (Section 13) and move on.

## 4. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server actions, RSC, mature ecosystem for full-stack apps |
| Language | TypeScript strict | Type safety end-to-end via Drizzle |
| Database | Supabase (Postgres) | Free tier, hosted Postgres, includes Realtime + Storage if needed |
| ORM | Drizzle | Type-safe, less magic than Prisma, lighter |
| Auth | Clerk | Fastest to ship — Google sign-in works out of the box, free tier covers v1 |
| Realtime | Supabase Realtime | Live vote updates without page refresh |
| Styling | Tailwind 4 | Familiar from blog project |
| UI components | shadcn/ui | Different priority from blog — speed > design distinctiveness here |
| Forms | react-hook-form + zod | Validate client and server with same schema |
| Email | Resend | Cheapest dev-friendly transactional email, great DX |
| Hosting | Vercel | Same as blog, free tier covers a 12-person app for years |
| Analytics | Vercel Web Analytics | Privacy-respecting, free, sufficient for v1 |

Do not introduce new dependencies without asking.

## 5. Data model

Seven tables. Field names and FK ON DELETE behavior finalized here so no drift later.

### `users`
- `id` (text, PK, from Clerk userId)
- `email` (text)
- `display_name` (text)
- `avatar_url` (text, nullable)
- `created_at` (timestamp)

### `circles`
- `id` (uuid, PK)
- `slug` (text, unique — used in URLs like `/c/[slug]`)
- `name` (text — e.g. "Hyderabad Crew")
- `created_by` (text, FK users.id, **ON DELETE SET NULL** — circle survives if creator deletes account; remaining admins keep ownership)
- `created_at` (timestamp)

### `memberships`
- `id` (uuid, PK)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `circle_id` (uuid, FK circles.id, **ON DELETE CASCADE**)
- `role` (enum: `admin` | `member`)
- `joined_at` (timestamp)
- Unique constraint: (user_id, circle_id)

### `invites`
- `id` (uuid, PK)
- `circle_id` (uuid, FK circles.id, **ON DELETE CASCADE**)
- `code` (text, unique — short opaque string for URL)
- `created_by` (text, FK users.id, **ON DELETE CASCADE** — privacy: deleting a user wipes the invites they generated)
- `expires_at` (timestamp, nullable)
- `max_uses` (int, nullable)
- `uses` (int, default 0)
- `created_at` (timestamp)

### `plans`
- `id` (uuid, PK)
- `circle_id` (uuid, FK circles.id, **ON DELETE CASCADE**)
- `title` (text — e.g. "Dinner at Karan's")
- `type` (enum: `eat` | `play` | `chai` | `stay-in` | `other`)
- `starts_at` (timestamp — exact time)
- `is_approximate` (boolean — if true, render as "this weekend" / "Sat evening" instead of exact time)
- `location` (text, nullable — free text, no DB of places)
- `max_people` (int, nullable)
- `created_by` (text, FK users.id, **ON DELETE SET NULL** — historical plans persist even after the creator deletes their account; per §12 privacy)
- `status` (enum: `active` | `confirmed` | `done` | `cancelled`, default `active`)
- `cancelled_at` (timestamp, nullable — set when status flips to `cancelled`; used to hide cancelled plans older than 24h)
- `reminder_sent_at` (timestamp, nullable — set after the 1-hour-before reminder cron sends an email; prevents re-sending on later cron ticks)
- `decide_by` (timestamp, nullable — optional "have an answer by" deadline; powers the countdown on the featured plan card)
- `created_at` (timestamp)

### `votes`
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `status` (enum: `in` | `out` | `maybe`)
- `voted_at` (timestamp)
- Unique constraint: (plan_id, user_id) — one vote per user per plan, latest wins

### `comments`
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `body` (text)
- `created_at` (timestamp)
- No editing or deletion in v1 — keeps the thread honest

### Cascade summary

Deleting a **user** cascades to: `memberships`, `votes`, `comments`, `invites` (created by them). It nullifies `created_by` on `circles` and `plans` they created — those records persist as orphans.

Deleting a **circle** cascades to: `memberships`, `invites`, `plans` → and through plans to `votes` and `comments`.

Deleting a **plan** cascades to: `votes`, `comments`.

## 6. v1 user flows

Six flows. If a flow is not listed, it doesn't exist in v1.

### Flow A — First-time signup + create circle
1. Land on `/`
2. Sign in with Google (Clerk)
3. If user has no circles: prompted to either "Create a circle" or "Have an invite link?"
4. Create flow: enter circle name → auto-generate slug → user becomes admin → redirected to `/c/[slug]`

### Flow B — Join via invite
1. Friend opens `/invite/[code]` (sent via WhatsApp)
2. If not signed in: sign in (Google, Clerk)
3. Auto-join circle as member, redirect to `/c/[slug]`
4. Invite link consumed (uses++) but reusable until expiry/max_uses

### Flow C — Create a plan
1. On `/c/[slug]`, tap "+ New plan" button (always visible, sticky on mobile)
2. Form: title (required), type (4 chips: Eat / Play / Chai / Stay-in, plus "Other"), datetime picker (with "approximate?" toggle), location (optional), max-people (optional)
3. Submit → plan appears at top of "Upcoming" list → email sent to all circle members
4. Creator's vote auto-set to `in`

### Flow D — Vote on a plan
1. Each plan card has 3 buttons: 🟢 In · 🔴 Out · 🟡 Maybe
2. Tap to vote — UI updates instantly (optimistic), syncs to DB
3. Vote count updates live for everyone in the circle (Supabase Realtime)
4. Tap the count to see avatars + names of who voted what

### Flow E — Discuss a plan
1. Tap a plan card → opens `/c/[slug]/p/[plan-id]`
2. Plan detail: full info, vote breakdown, comment thread
3. Add a comment → appears live for everyone
4. Email sent to anyone who voted on the plan when a new comment is added (NOT to whole circle)

### Flow F — Mark plan done / cancel
1. Plan creator OR any admin can mark a plan `done` or `cancelled` from the detail page
2. `done` plans move to "Past" section on circle page
3. `cancelled` plans get a strikethrough, stay visible for 24h, then hide
4. Past/cancelled plans not editable

## 7. Page inventory

```
/                       → marketing-lite landing or redirect-to-circle if signed in
/sign-in                → Clerk
/sign-up                → Clerk
/onboarding             → choose: create circle OR enter invite code
/c/[slug]               → circle home: upcoming + past plans, "+ New plan" button
/c/[slug]/p/[plan-id]   → plan detail: votes + comments
/c/[slug]/settings      → admin only: rename circle, manage invites, view members
/invite/[code]          → join handler
```

That's it. Eight routes max. Resist adding more in v1.

## 8. Design direction

This is NOT the blog. Different priorities:

- **Mobile-first, not desktop-first.** Friends will use this on phones at 7pm on Saturday while figuring out dinner. Every screen must feel native on a 380px viewport.
- **Speed > polish.** Every interaction should feel instant. Optimistic updates everywhere.
- **Functional > beautiful.** shadcn defaults are fine for v1. Don't spend cycles on a custom design system.
- **Familiar over novel.** Use patterns from Partiful, Lu.ma, and even WhatsApp where applicable. Don't invent UX.

Color palette: slate base + three semantic accents — green for "in", red for "out", yellow for "maybe". No editorial seriousness needed.

Typography: Geist (sans, already loaded) for body, meta, and lists. Source Serif 4 via next/font/google for headlines and large display numerals — added in M16 to support the editorial home and plan-detail aesthetic.

## 9. Performance + UX targets

Non-negotiable before inviting friends:

- First page load on 4G mobile: **under 2.5s LCP**
- Vote action → UI update: **under 100ms** (optimistic, network can take its time)
- Vote action → other devices update: **under 1s** (Realtime)
- Lighthouse Performance + Accessibility: **90+** on the circle page on mobile
- App must work fully on a 4-year-old Android with average network — test by throttling to "Slow 4G" in DevTools before shipping
- Empty states for: no circles yet, no plans yet, no comments yet, no votes yet — never show a blank screen

## 10. Build sequence (milestones)

Each milestone ends with a working deploy and a git commit/push. Do not start the next until the previous is green and pushed to Vercel.

- **M0** — Spec lock. PLAN.md done, Clerk + Supabase + Resend + Vercel accounts created. (1 hour, mostly account signups)
- **M1** — Project scaffold. Next.js 15 + Tailwind + Drizzle + Clerk + Supabase wired. Hello-world auth flow working. Deploy to Vercel. (2 hours)
- **M2** — Database schema + migrations. All 7 tables created in Supabase via Drizzle migrations. Seed script for dev. Verify in Supabase dashboard. (1 evening)
- **M3** — Onboarding + circle creation. Flows A and B complete. Can sign up, create a circle, generate an invite, join via invite (test with second account in incognito). (1 evening)
- **M4** — Plans CRUD + listing. Flow C complete. Can create plans, see them on `/c/[slug]`, separated upcoming/past. (1 evening)
- **M5** — Voting + Realtime. Flow D complete. Live vote tally working across browsers. Test with two devices side by side. (1 evening — most important UX milestone)
- **M6** — Plan detail + comments. Flow E complete. Realtime comments. (1 evening)
- **M7** — Mark done/cancel + email notifications. Flow F + Resend integration. Three emails: new plan, new comment on plan you voted on, plan cancelled. (1 evening)
- **M8** — Mobile polish + empty states + onboarding copy. Test on real Android phone, not DevTools. Fix every awkward state. (1 evening)
- **M9** — Ship to friends. Send invite link to WhatsApp group with one sentence. (15 minutes)
- **M10** — Watch and learn. Build NOTHING for 2 weeks. Take notes on usage, complaints, what's ignored. (2 weeks of patience)

Total active build time: ~8-10 evenings. Calendar time: 3-4 weekends if life cooperates.

## 11. What gets built in M11+ depends entirely on M10 observations

Common scenarios I'm preparing for, with the likely v2 response:

- **"Nobody uses it, WhatsApp wins"** → Build a WhatsApp bot version, abandon web app, or accept defeat. Don't add features.
- **"Everyone votes but nobody comments"** → Cut comments, lean into vote-only UX.
- **"Plans get created but votes are sparse"** → Add a daily digest email "3 plans need your vote."
- **"People want to suggest places"** → Add `suggested_locations` to plan: anyone can add, others vote.
- **"It works, want it native"** → Wrap with Capacitor or add to home screen as PWA. Don't rebuild as native.

## 12. Privacy + safety

- Circles are invite-only. No public listing of circles or members.
- Invite codes are opaque (cryptographically random, ≥12 chars).
- Email addresses never visible to other circle members — only display name + avatar.
- Comments and plan content visible only to circle members.
- One sentence privacy policy at `/privacy`: "We store your name, email, and avatar from Google. We store the plans, votes, and comments you create. We don't share data with anyone. Email shivam@... to delete your account."
- Account deletion = hard delete from DB (cascades to votes, comments, memberships). Plans you created stay (orphan creator).

## 13. v2 wishlist (DO NOT BUILD IN V1)

Park ideas here when tempted. Revisit after M10 observations. Order is not a priority ranking.

- Calendar view of upcoming plans
- Recurring plan templates ("Sunday chai")
- Push notifications via web push
- Place suggestions sub-feature (vote between 2-3 venues)
- "Bring something" list per plan (one person brings chai leaves, another brings snacks)
- Photo dump after plan marked done
- Spending split per plan
- Multi-circle UX (switch between groups in nav)
- AI tie-breaker: when vote is split, Claude suggests an option
- WhatsApp bot version
- iOS/Android wrapper via Capacitor
- "Quiet hours" — pause notifications 11pm-8am
- Per-user "auto-vote" defaults ("auto-Maybe for plans I don't respond to in 24h")
- Plan templates ("birthday dinner" auto-fills location, type, max-people from past instances)
- Smarter reminder copy — "Tonight at" is hardcoded in the M15 reminder subject; brunch plans read "Tonight at 11:00 AM." Pick "Today" / "Tonight" / "Tomorrow" based on local time of the plan vs. the recipient.

## 14. File layout (proposed, finalize in M1)

```
.
├── CLAUDE.md
├── PLAN.md
├── README.md
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── drizzle.config.ts
├── package.json
├── .env.local                 # gitignored: DB url, Clerk keys, Resend key
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # /
│   │   ├── (auth)/
│   │   │   ├── sign-in/
│   │   │   └── sign-up/
│   │   ├── onboarding/
│   │   ├── invite/[code]/
│   │   ├── c/[slug]/
│   │   │   ├── page.tsx       # circle home
│   │   │   ├── p/[planId]/
│   │   │   │   └── page.tsx   # plan detail
│   │   │   └── settings/
│   │   └── api/
│   ├── components/
│   │   ├── ui/                # shadcn
│   │   ├── plan-card.tsx
│   │   ├── vote-buttons.tsx
│   │   ├── comment-thread.tsx
│   │   └── new-plan-form.tsx
│   ├── db/
│   │   ├── schema.ts          # Drizzle table definitions
│   │   ├── client.ts          # Drizzle client instance
│   │   └── seed.ts
│   ├── lib/
│   │   ├── auth.ts            # Clerk helpers
│   │   ├── realtime.ts        # Supabase realtime subscriptions
│   │   ├── email.ts           # Resend wrappers
│   │   └── utils.ts
│   └── styles/
│       └── globals.css
└── drizzle/                   # migrations
```

## 15. Working agreement with Claude Code

- Always read PLAN.md and CLAUDE.md at the start of a session.
- Work one milestone at a time.
- After every milestone: `pnpm lint && pnpm build` → `git add -A` → show me `git status` → wait for commit approval → commit with `mN: <description>` → push.
- Before adding any dependency: ask.
- Before changing the data schema: update PLAN.md section 5, then ask.
- Before adding any feature not in section 6 or 7: stop, ask if it's worth deferring to v2.
- After finishing a milestone, summarize in 3 bullets so I can write the commit and the changelog entry.
