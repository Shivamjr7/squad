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
- ~~**Push notifications**~~ — promoted into scope at M26 (opt-in capture) and M30 (delivery). Email reminders dropped in M30 in favor of a single 30-min push.
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

### Post-M16 additions (plans table)

The following columns are added to `plans` in M19 / M22:

- `time_mode` (enum: `exact` | `open`, default `exact`) — M19. `open` = the squad votes on the hour rather than the creator picking it.
- `lock_threshold` (int, default 5) — M22. Plan auto-locks when this many `in` votes converge on a single time + venue, or when `decide_by` is reached (whichever comes first).

### Post-M16 additions (users table)

- ~~`push_subscription` (jsonb, nullable) — M26.~~ Replaced in M30 by the dedicated `push_subscriptions` table so the same user can receive pushes on phone + desktop simultaneously. The column is dropped in the M30 migration.

### `time_slots` (M20)
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `starts_at` (timestamp — top of an hour window)
- `duration_minutes` (int, default 60)

### `time_slot_votes` (M20)
- `id` (uuid, PK)
- `slot_id` (uuid, FK time_slots.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `voted_at` (timestamp)
- Unique constraint: (slot_id, user_id)

### `plan_venues` (M21)
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `label` (text — "Roxie Theater" or "Karan's place")
- `suggested_by` (text, FK users.id, **ON DELETE SET NULL**)
- `created_at` (timestamp)

### `plan_venue_votes` (M21)
- `id` (uuid, PK)
- `venue_id` (uuid, FK plan_venues.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `voted_at` (timestamp)
- Unique constraint: (venue_id, user_id)

### `plan_time_proposals` (M22, extended in M24)
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `starts_at` (timestamp)
- `proposed_by` (text, FK users.id, **ON DELETE SET NULL**)
- `kind` (enum: `replacement` | `addition`, default `replacement`) — M24. `addition` = a stacked sub-plan ("dinner after at Bar Tartine") rather than an alternative for the same slot.
- `label` (text, nullable) — M24. Sub-plan description for `addition` rows ("Dinner after at Bar Tartine"). Null for `replacement`.
- `created_at` (timestamp)

### `plan_time_proposal_votes` (M22)
- `id` (uuid, PK)
- `proposal_id` (uuid, FK plan_time_proposals.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- Unique constraint: (proposal_id, user_id)

### `plan_recipients` (M23)
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- Unique constraint: (plan_id, user_id)
- Empty set for a plan = full circle (back-compat for plans created before M23).

### `push_subscriptions` (M30)
- `id` (uuid, PK)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `endpoint` (text, unique — push service URL; identity for upserts and 410-Gone cleanup)
- `p256dh` (text — subscription's public key half, used by AES-128-GCM encryption)
- `auth` (text — subscription's auth secret half)
- `device_hint` (text, nullable — "mobile" | "desktop" sniffed at subscribe time)
- `created_at` (timestamp)
- `last_used_at` (timestamp, nullable — refreshed after every successful push)
- One row per device. Subscribe upserts on `endpoint`; unsubscribe deletes a single row by `endpoint`. A 410 Gone from the push service deletes the row for that endpoint only — never wipes other rows for the same user.

### `notifications` (M30)
- `id` (uuid, PK)
- `user_id` (text, FK users.id, **ON DELETE CASCADE**)
- `type` (enum: `vote_in` | `plan_created` | `plan_reminder`)
- `payload` (jsonb — kind-specific shape; see `src/lib/notifications.ts` `NotificationPayload`)
- `read_at` (timestamp, nullable — null = unread, drives the bell badge)
- `created_at` (timestamp)
- Index: `(user_id, created_at)` so the feed query is fast at scale.

### `plan_events` (M24)
- `id` (uuid, PK)
- `plan_id` (uuid, FK plans.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE SET NULL**)
- `kind` (enum: `created` | `voted` | `proposed_time` | `proposed_venue` | `added_member` | `locked` | `cancelled`)
- `payload` (jsonb — details, e.g. `{"vote": "in"}` or `{"time": "8:30 PM"}`)
- `created_at` (timestamp)

### Suggest Plan additions — S1 (circles table)

Persistent geo + radius for the circle's "home" area. Powers `circleCentroid` fallback in the suggestion pipeline when the user denies geolocation. All nullable / defaulted — back-compat for existing circles.

- `home_location_text` (text, nullable) — human label, e.g. "Banjara Hills"
- `home_lat` (double precision, nullable)
- `home_lng` (double precision, nullable)
- `home_radius_km` (int, default 5)

### Suggest Plan additions — S1 (plan_venues table)

Tracks venue provenance so we can distinguish manually-typed venues from suggestion-sourced ones, and close the feedback loop when a suggestion-sourced venue wins / gets cancelled.

- `source` (text, default `manual`) — `manual` | `suggestion`
- `suggestion_item_id` (uuid, FK suggestion_log_items.id, **ON DELETE SET NULL**) — feedback target for `won` / `cancelled` writes
- `external_id` (text, nullable) — provider-stable id, e.g. `gp:ChIJ…`
- `external_url` (text, nullable)
- `external_geo` (jsonb, nullable) — `{ lat, lng }`

### `circle_preference_signals` (Suggest Plan S1)

Aggregated taste / behavior signal per circle. Source of truth for the `GroupPreferenceProfile` view. Updated lazily on `plan_venues` writes, vote events, and post-lock outcomes — not real-time.

- `id` (uuid, PK)
- `circle_id` (uuid, FK circles.id, **ON DELETE CASCADE**)
- `signal_kind` (text — `cuisine` | `category` | `price` | `recent_venue` | `hard_exclusion`)
- `signal_key` (text — kind-specific key, e.g. `south_indian`, `cafe`, `$$`, venue label)
- `weight` (int — scaled ×1000 for precision; `−1000..1000` for affinities, `0..1000` for recency)
- `cohort` (jsonb, nullable — subset of user ids the aggregation considered; null = whole circle)
- `updated_at` (timestamp)
- Unique constraint: (circle_id, signal_kind, signal_key)

### `suggestion_logs` (Suggest Plan S1)

One row per `getSuggestions` call. Full reproducibility — every result can be re-ranked offline from the stored snapshot.

- `id` (uuid, PK)
- `circle_id` (uuid, FK circles.id, **ON DELETE CASCADE**)
- `user_id` (text, FK users.id, **ON DELETE SET NULL**)
- `plan_id` (uuid, FK plans.id, **ON DELETE SET NULL** — set lazily when a plan is created from the suggestion)
- `request_nonce` (uuid — client-generated; idempotency key)
- `context` (jsonb — PII-scrubbed `SuggestionContext` snapshot, lat/lng quantized to geohash-6)
- `weights` (jsonb — ranking weights used)
- `degraded` (jsonb, nullable — `[{ provider, reason }]`)
- `outcome` (text, default `served` — `served` | `refreshed` | `empty` | `errored`)
- `generated_at` (timestamp)
- Unique constraint: (user_id, request_nonce)

### `suggestion_log_items` (Suggest Plan S1)

One row per surfaced result. Carries the normalized `Activity` and `ScoreBreakdown` for offline replay + admin debugging.

- `id` (uuid, PK)
- `log_id` (uuid, FK suggestion_logs.id, **ON DELETE CASCADE**)
- `rank` (int — 1..limit)
- `activity` (jsonb — normalized Activity)
- `breakdown` (jsonb — ScoreBreakdown)
- `score` (int — scaled ×1000, 0..1000)
- `feedback` (text, nullable — `add` | `reject` | `refresh` | `won` | `cancelled`)
- `feedback_at` (timestamp, nullable)

### `provider_cache` (Suggest Plan S1)

Keyed cache for provider responses + a coarse daily call counter. No Redis — Postgres is enough at friend-group scale.

- `key` (text, PK — sha256 of `provider + canonicalJson(input)`)
- `provider` (text)
- `value` (jsonb — normalized payload, NOT raw provider JSON)
- `expires_at` (timestamp)
- `metadata` (jsonb, nullable — e.g. `{ dailyCount, day }`)
- `created_at` (timestamp)
- A daily pg_cron job deletes expired rows (added in S9).

### Cascade summary

Deleting a **user** cascades to: `memberships`, `votes`, `comments`, `invites` (created by them). It nullifies `created_by` on `circles` and `plans` they created, plus `user_id` on `suggestion_logs` — those records persist as orphans.

Deleting a **circle** cascades to: `memberships`, `invites`, `plans` → and through plans to `votes` and `comments`. Also cascades to `circle_preference_signals` and `suggestion_logs` → and through logs to `suggestion_log_items`.

Deleting a **plan** cascades to: `votes`, `comments`. It nullifies `plan_id` on `suggestion_logs` so suggestion-feedback history survives.

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

**Post-launch additions (after M10 observations):**

- **M11–M13** — Stabilization. Post-signin redirect to most-recent circle, mobile nav polish, plan confirmation flow (`confirmed` status + email).
- **M14** — Multi-circle UI. Circle switcher in every page header (sheet on mobile, popover on desktop). `/onboarding` reopened as "Add another circle" for existing users. Email subjects + bodies include circle context.
- **M15** — Auto-expiry + plan reminders. Originally specced as Vercel Cron; migrated mid-build because the Hobby tier limits crons to once daily. Final shape: Supabase `pg_cron` for the pure-SQL expire job (flips `status=done` 4h past `starts_at`), Supabase Edge Function (`supabase/functions/remind-plans/`) for the reminder email job (1-2h-out window, fans out to IN voters via Resend, stamps `reminder_sent_at` to prevent re-sends). Authed with a custom `CRON_SECRET` Bearer header — anon key is public.
- **M16** — Visual redesign of home + plan detail. Paper-and-ink palette (`--paper`, `--ink`, `--coral`, semantic `--in/--maybe/--out`), Source Serif 4 headlines added (PLAN.md §8 amended). Home: date row, hero "Tonight, *circle*?" headline, single featured plan card, compact upcoming rows with type-color bars, collapsible past. Plan detail: status + countdown line, "Current plan" card with big serif time + progress bar, equal-weight vote buttons, voter list with vote pills + timestamps, admin actions moved to a `···` overflow menu. Schema added `decide_by` (optional deadline → countdown).

**Post-M16 reference assets:**
- `REFERENCES/Squad-landing_Page.html` — full marketing landing for `/`.
- `REFERENCES/Screenshot 2026-04-27 at 1.40.11 PM.png` — three home/empty/create-plan mocks.
- `REFERENCES/Screenshot 2026-04-27 at 1.40.22 PM.png` — three plan-detail variants (decision card / live ticker dark / receipt).

The M17–M27 sequence below implements everything those references show. Source of truth for M17+ scope.

- **M17** — Marketing landing page. Replace the sparse sign-in card at `/` with the full landing from `Squad-landing_Page.html`. Sections: top nav, hero ("Stop scrolling. Start *showing up*."), hero phone-mockup contrast (WhatsApp scrollback vs. Squad plan card), logo strip ("As planned by squads at"), problem section ("The way it is" + animated WhatsApp dialogue), three-step "How it works", "One source of truth" plan-card explainer with four feature blocks, six-feature grid ("Built for the question — Are we still on?"), four stats blocks + Mira K. testimonial, final CTA + iOS/Android badges, footer. Add Instrument Serif via `next/font/google` for italic accents (paired with existing Source Serif 4 for headlines). Stub `/privacy` and `/terms`. Signed-in users still redirect to most-recent circle. Lighthouse mobile 90+ on `/`. (1 evening)
- **M18** — Bottom tab bar + Squad and You routes. Persistent three-tab bar on every authenticated circle page: **Plans** (`/c/[slug]`), **Squad** (`/c/[slug]/squad` — members list, admin invite/remove), **You** (`/c/[slug]/you` — display-name edit, email read-only, notification prefs, sign-out, leave-circle). Settings remains admin-only at `/c/[slug]/settings`, accessed via gear from Squad. Fixed-bottom on mobile, in-page sidebar on `md:` desktop. (1 evening)
- **M19** — Empty state + create-plan redesign. Empty state on `/c/[slug]` when no plans: orbital "?" graphic (CSS-only, three concentric rings with staggered orbiting dots) + "No plan yet." headline + copy verbatim from screenshot 02 + "+ Start a plan" CTA. Create-plan sheet redesign: full-screen on mobile, `Cancel · NEW PLAN · Send` header, "Anyone free *tonight*?" hero (auto-substitutes today/tonight/this-weekend), caps-label fields (WHAT / WHEN / WHERE), WHEN segmented control (`Exact time` | `Open — squad picks`), WHERE multi-input ("Add another option"), TIME picker with "decide-by" chip selector (1h / 2h / 4h / Tonight / Tomorrow), recipients chip picker ("ALL · N SELECTED"), pink "Set a deadline" callout when `decide_by` is unset. Schema: add `plans.time_mode` (M19 column on existing table). Open-mode logic stub only — full impl in M20. (1 evening)
- **M20** — Time consensus voting. Implements `time_mode = 'open'`. Schema: `time_slots` + `time_slot_votes`. Default slot range generated on plan create (e.g. 6–11 PM). Plan-detail heatmap row of hour cells; tap to vote, optimistic + Realtime. Lock when `decide_by` hits OR ≥ 5 voters land on the same hour: set `plans.starts_at`, flip `time_mode → exact`, `status → confirmed`, send "It's happening" email to recipients. Lock job extends existing `remind-plans` Edge Function. (1-2 evenings)
- **M21** — Venue voting. Schema: `plan_venues` + `plan_venue_votes`. Multi-venue create form (M19's "Add another option" goes live). Plan-detail: swipeable card stack of venues on mobile, tile row on desktop. One vote per user; switching deducts previous. Leading venue surfaces on home featured card and upcoming list. On lock, winning venue's `label` becomes the canonical `plans.location` (free-text fallback path stays intact for single-venue plans + maps + emails). Anyone in recipients can add a venue mid-flight (counter-proposal). (1 evening)
- **M22** — Counter-proposals + auto-lock. Schema: `plan_time_proposals` + `plan_time_proposal_votes` + `plans.lock_threshold` column (default 5). For exact-time plans, the original `starts_at` is auto-seeded as the first proposal row; counter-proposals stack on top. Auto-lock rule: `votes` with `in` ≥ `lock_threshold` AND single time+venue plurality → confirm; OR `decide_by` reached → confirm with current plurality (ties = earliest-proposed). Lock email "It's happening — 8:30 at Roxie" to in/maybe voters. "+ Suggest another time" UI on plan detail. "PLAN LOCKS AT 8:30 IF 5+ ARE IN" footer line. (1-2 evenings)
- **M23** — Per-plan recipients. Schema: `plan_recipients`. M19's chip picker now writes real rows. Empty set = full circle (back-compat). Email fan-out targets recipients only. Home filters out plans the user isn't a recipient of (admin sees all). Vote eligibility scoped to recipients; non-recipients see "you weren't invited — ask <creator>". Plan-detail Squad section + button (creator/admin) to add members mid-flight. (1 evening)
- **M24** — Plan-detail variants (live ticker + receipt). Three skins, same data: **A — Decision card** (light, default; polish from M16 — voter list with timestamps, color spectrum bar, "DECIDING NOW · ENDS 8:30 PM" header). **B — Live ticker** (dark, when `decide_by - now() < 30 min` AND unlocked; big "4 / 6 in" tally hero, WHEN/WHERE/PLUS rows where PLUS is a stacked sub-plan via `plan_time_proposals.kind = 'addition'`, big "You're in" CTA + "Change", "PLAN LOCKS AT 8:30 IF 5+ ARE IN" footer). **C — Receipt** (cream, post-lock; "The Plan" serif header, receipt-style WHEN/WHERE/AFTER/RVD rows, activity log from new `plan_events` table, frozen vote buttons). Variant chosen server-side. Schema: `plan_events` + `plan_time_proposals.kind` column. Receipt is print-styled (`@media print`) for shareable screenshots. (1-2 evenings)
- **M25** — Maps + calendar deep-links. "Open in Maps" button on plan-detail (A/C) and home featured card — Apple Maps URL on iOS Safari (UA-detected server-side), Google Maps URL elsewhere. "Add to calendar" route at `/api/plans/[id]/ics` generating ICS on the fly (title, `starts_at`, `+2h` end default, location, description with circle name + plan URL). Google Calendar tap-out URL as alternate. Walking-time hint under venue, computed client-side via `navigator.geolocation` if granted; silently hidden if denied. (1 evening)
- **M26** — PWA install + Web Push opt-in. `public/manifest.webmanifest` (theme paper, icons 192/512), service worker (confirm `next-pwa` is acceptable to add — ask before installing), offline read of circle home shell, "Install Squad" dismissible banner on `/c/[slug]` (30-day cookie; uses `beforeinstallprompt` on Android Chrome, iOS share-sheet copy on iOS Safari). Web Push opt-in toggle on `/c/[slug]/you` — stores subscription to `users.push_subscription`. Firing pushes happens in M27. Lighthouse PWA = installable. (1 evening)
- **M27** — Stats + polish + ship update. Real stats dashboard at `/c/[slug]/stats` (admin only): time-to-decision (median + P90), lock vs. expire %, squad size + active-voter count, counter-proposal rate. Wire landing-page stat blocks to global anonymized aggregates (placeholder copy fallback if < 10 plans exist). Update Resend templates (`new-plan`, `new-comment`, `plan-locked` new, `plan-cancelled`, `reminder`) to paper/ink visual. Reminder copy fix: today/tonight/tomorrow per local time of the plan vs. recipient (closes the v2-wishlist nit). Onboarding tour for first-time users: 3 dismissible tooltips on home. Lighthouse 90+ on `/`, `/c/[slug]`, `/c/[slug]/p/[id]`. WhatsApp re-announcement to friends. (1-2 evenings)
- **M28** — UX polish bundle on `feature/notifications`. Documented retroactively from PR #1 + da74a8a. Adds the always-visible `Sidebar` + `AppShell` layout for `/c/[slug]/(shell)/*`, "My plans" page at `/c/[slug]/plans`, mobile nav refinements, weather chip + home subline on circle home, `SquadPulse` activity component, horizontal `UpcomingStrip`, `QuickNudge` CTA, featured-plan card refresh. No schema changes. (1-2 evenings, shipped)
- **M29** — Full-quorum auto-lock + vote event signal. Two pieces, no schema changes.
  - **All-voted lock**: third trigger in `auto-lock.ts`, complementary to M22's threshold + `decide_by` paths. New helpers `getEligibleVoters(planId)` and `allEligibleVotersHaveVoted(planId)` in `lib/actions/`. Eligibility follows M23 — `plan_recipients` rows if non-empty, else all current circle members (membership row presence implies active; deletion = inactive). "Voted" = any `votes` row with status `in`/`out`/`maybe`. Trigger fires (a) after every vote upsert, (b) as an idempotent recheck on plan-detail load to cover races. On match, flip `plans.status` → `confirmed` via the same M22 plurality path; lock timestamp is the `created_at` of the corresponding `plan_events` row.
  - **Vote event signal**: on every successful vote upsert, write a `plan_events` row (reuses M24 table) with `kind = 'voted'` and `payload = { vote, previous_vote, in_count, out_count, maybe_count }`. Auto-locks already write `kind = 'locked'` per M22; M29 keeps that as-is. Fire-and-forget — no UI reads these yet, no emails, no pushes. M30 owns delivery + spam policy. (1 evening)
- **M30** — Notifications: in-app feed + Web Push delivery. Three pieces.
  - **Schema**: drop `users.push_subscription` jsonb; add `push_subscriptions` (per-device, identity = `endpoint`, with `p256dh` + `auth` + `device_hint` + `last_used_at`) and `notifications` (per-user feed rows with `type`, `payload`, `read_at`). Migration `0016_push_subs_and_notifications.sql`.
  - **In-app**: bell tab at `/c/[slug]/notifications` with feed + unread badge in the bottom tab bar / sidebar. Server actions in `lib/actions/notifications.ts` (list, count, mark read, mark all read). Three trigger sources, all writing through `lib/notifications.ts` `dispatchNotifications`:
    - `vote_in` — fires from `castVote` only on the IN edge (first cast as `in`, or switch from out/maybe → in). Audience = plan recipients minus voter (full circle if no recipient set).
    - `plan_created` — fires from `createPlan`. Audience = plan recipients minus creator.
    - `plan_reminder` — fires from the `remind-plans` edge function for confirmed plans starting within the next hour, gated by `reminder_sent_at`. Audience = in/maybe voters intersected with recipient set.
  - **Web Push**: new `supabase/functions/send-push/` edge function uses `npm:web-push@3` with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) to fan a notification ID set out to every `push_subscriptions` row for the recipient. The Next.js trigger sites call it via authed HTTP fetch (fire-and-forget); the cron does the same inline. 404/410 responses delete only the specific endpoint row. Service worker `public/sw.js` handles the `push` event (renders title/body/url) and `notificationclick` (focuses or opens the URL). PWA cache version bumped to `squad-shell-v2`.
  - **What dropped**: the M15 Resend reminder email is gone. Lock + confirmation + cancellation emails stay — those carry text that doesn't fit a push body. Reminder window tightened from 1–2h to "within the next hour" so the cron can land closer to the 30-min target without rescheduling pg_cron. (1-2 evenings)

Total active build time: ~8-10 evenings (M0-M16) + ~10-13 evenings (M17-M27) + ~1 evening (M29; M28 documented retroactively) + ~1-2 evenings (M30). Calendar time: depends entirely on M10 observations and how many of M17+ still feel right post-launch.

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
- Approximate-plan auto-expiry — M15's pg_cron flips `status=done` when `starts_at + 4h < now()`. For `is_approximate = true` plans, `starts_at` is a fuzzy stand-in ("this weekend" / "next week"), so a plan whose author picked Saturday 9am can auto-expire by Saturday 1pm even if friends actually plan to meet Saturday night. Fix in v2 by either using a longer grace when `is_approximate`, or treating `starts_at` as a day-bucket and expiring at end-of-day.

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
├── drizzle/                   # migrations
└── supabase/
    └── functions/
        └── remind-plans/      # Edge Function (Deno) for the M15 reminder cron
```

## 15. Working agreement with Claude Code

- Always read PLAN.md and CLAUDE.md at the start of a session.
- Work one milestone at a time.
- After every milestone: `pnpm lint && pnpm build` → `git add -A` → show me `git status` → wait for commit approval → commit with `mN: <description>` → push.
- Before adding any dependency: ask.
- Before changing the data schema: update PLAN.md section 5, then ask.
- Before adding any feature not in section 6 or 7: stop, ask if it's worth deferring to v2.
- After finishing a milestone, summarize in 3 bullets so I can write the commit and the changelog entry.
