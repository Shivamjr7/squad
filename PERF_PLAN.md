# PERF_PLAN.md — Performance roadmap

> Source of truth for the perf overhaul. Read this if context is lost.
> Goal: WhatsApp/Instagram-level "feels instant" — tab switches under 100ms perceived, votes and comments under 50ms perceived, no blank screens during nav.
>
> The earlier files `PERFORMANCE_IMPROVEMENTS.md`, `PERF_OPTIMIZATION_GUIDE.md`, and `BUILD_STATUS.md` contained fabricated metrics and described a client layer that is actively hurting perf. They are deleted in Phase 1.

## Diagnosis (verified by reading the code, not guessing)

### 1. The "optimized" client layer is double-fetching and breaking Link
- `OptimizedSidebar` mounts on every nav and fires `useUserCircles` (`/api/user/circles`), `useNotifications` (`/api/notifications`), and an `AroundNowAsync` `useEffect` (`/api/circles/[slug]/activity`). **All three are already computed server-side and rendered into the page.** Every tab switch = 3 redundant HTTP roundtrips after SSR finishes.
- `OptimizedLink.handleClick` calls `e.preventDefault()` then `router.push(href)`. This **defeats Next.js Link's standard prefetched-RSC navigation** — the prefetched payload is wasted and we fall back to a slower client-only push.
- `requestCache` in `request-dedup.ts` only retains entries for 100ms — far too short to dedupe a real session.
- The whole client cache is in-memory only (gone on reload), so it does nothing for first paint and very little for tab switching.

### 2. The server pages do too many DB roundtrips
- **Home page**: ~7 queries — `getCircleMembers`, `getUserCircles`, `pushSubscriptions`, `plans`, `votes` (per upcoming plan), `planVenues` + `planVenueVotes` (2 queries), `planEvents.max()`, `getCircleMemberActivity` (2 aggregations).
- **Plan-detail**: 10+ queries + `tryAutoLock` runs an extra 5 DB queries on **every page view** of an active plan past `decide_by`, even though auto-lock is conceptually a write-path concern.
- `unstable_cache` tags are too broad. One vote invalidates the whole `circle-activity` / `circle-members` bucket for every circle.

### 3. No perceived-perf scaffolding
- **No `loading.tsx` anywhere.** Tab switches freeze on the old page until the new server response arrives.
- **No `Suspense` boundaries** around below-fold sections (Squad Pulse, Suggest Panel, last-edit, recipients). The whole page waits on the slowest query.

### 4. Routing isn't prefetching what it should
- The custom `CircleLink` → `OptimizedLink` hijacks the click event, so even the prefetch=true it sets gets bypassed.
- The vanilla `<Link>` in plan cards has no `prefetch` hint.

### 5. Optimistic updates are inconsistent
- Vote buttons are optimistic. Comments, venue/proposal/slot votes, mark-done, cancel, create-plan are partial or full-roundtrip.

---

## The plan

Six phases. Each ends with `pnpm lint && pnpm build` and a commit (`mN: <description>` per CLAUDE.md).

### Phase 1 — Stop the bleeding ✂️
The fastest wins come from removing the harmful client layer.

1. Drop the `handleClick` override in `OptimizedLink`. Replace `OptimizedLink` / `CircleLink` / `PlanLink` with vanilla `next/link` plus a thin `prefetch={true}` wrapper that **does not** preventDefault.
2. Pass `userCircles`, `unreadCount`, and `lastActiveByUser` into `OptimizedSidebar` as props from the server layout (these are already computed there). Delete the three client `useEffect` fetches.
3. Delete the dead client cache layer:
   - `src/lib/cache/data-cache.ts`
   - `src/lib/cache/request-dedup.ts`
   - `src/lib/cache/preload-manager.ts`
   - `src/lib/cache/performance-optimizer.ts`
   - `src/hooks/use-optimized-data.ts`
   - `src/components/optimized/instant-navigation.tsx`
   - `src/components/optimized/performance-dashboard.tsx`
4. Delete the misleading docs: `PERFORMANCE_IMPROVEMENTS.md`, `PERF_OPTIMIZATION_GUIDE.md`, `BUILD_STATUS.md`.

**Expected gain**: ~200-400ms saved per tab switch, and the standard Next prefetch starts actually working.

### Phase 2 — `loading.tsx` + Suspense streaming
This is what makes WhatsApp / Instagram **feel** instant: paint a skeleton in <100ms while the server is still working.

1. Add `loading.tsx` at every tab boundary:
   - `src/app/c/[slug]/(shell)/loading.tsx`
   - `src/app/c/[slug]/(shell)/plans/loading.tsx`
   - `src/app/c/[slug]/(shell)/squad/loading.tsx`
   - `src/app/c/[slug]/(shell)/you/loading.tsx`
   - `src/app/c/[slug]/(shell)/notifications/loading.tsx`
   - `src/app/c/[slug]/(shell)/p/[planId]/loading.tsx`
   Each renders a skeleton matching the page layout (date row, hero, featured-card placeholder, upcoming chips).
2. Wrap heavy below-fold work in `<Suspense>` so the shell streams first:
   - `SquadPulse` (`getCircleMemberActivity`)
   - `SuggestPanel`
   - Featured-card "last edit" line (`planEvents.max()`)
   - Plan-detail recipient list, voter list, additions, deep links
3. Hoist `auth()` + `getCircleBySlug` + display-name check above Suspense so the hero paints immediately.

### Phase 3 — Collapse N queries into 1-2
Real server speed.

1. **Home**: one query that joins `plans`, `votes`, `plan_venues`, `plan_venue_votes` and aggregates in SQL (CTE or lateral joins). Plus one for `getCircleMemberActivity`.
2. **Plan-detail**: one nested-relational query for plan + creator + recipients + votes + venues + venueVotes + proposals + proposalVotes + slots + slotVotes. Drizzle's `with:` can express this.
3. Remove `tryAutoLock` from the read path entirely. Auto-lock only on write paths (`castVote`, plan mutations).
4. Tighten `unstable_cache` tags to per-circle (`circle:${id}:plans`, `circle:${id}:activity`) so a write to circle A doesn't invalidate circle B.

### Phase 4 — Optimistic everything
1. Vote: keep optimistic UI, use `useTransition` so the follow-up server re-render doesn't block.
2. Comment compose: append to list immediately, fire server action in background, reconcile on success.
3. Venue / proposal / slot votes: optimistic toggle (consistent across all three).
4. New-plan: insert into list immediately on submit, navigate to detail with data prefilled.
5. Mark-done / cancel: optimistic strikethrough / list removal.

### Phase 5 — Prefetch wiring
1. Vanilla `<Link prefetch>` on all sidebar tabs + plan cards.
2. `router.prefetch(href)` on hover / touchstart of every plan card.
3. Prefetch the home route from sign-in / set-name redirects.

### Phase 6 — Infra polish
1. Confirm Vercel deploy region and Supabase region match. If not, single DB roundtrip is 80-200ms instead of 5-10ms — single biggest infra lever.
2. Service worker (already PWA-scoped at M26) caches the shell + last RSC chunk so reloads paint instantly.
3. Verify Postgres indexes claimed by the old `PERF_OPTIMIZATION_GUIDE.md` actually exist in `drizzle/` migrations; `EXPLAIN ANALYZE` the home and plan-detail queries.

---

## Expected outcomes

| Metric | Before | Target |
|---|---|---|
| First load | 2-2.5s | 800ms-1.2s |
| Tab switch (perceived) | 600-1000ms | <100ms (skeleton in <50ms) |
| Vote / comment (perceived) | 200-400ms | <50ms (optimistic) |
| Reload of a visited page | full SSR | instant via SW shell |

## Working agreement

- One phase at a time. End each with `pnpm lint && pnpm build` + commit + push.
- Don't introduce new dependencies without asking.
- Don't change the data schema without updating PLAN.md §5 first.
- Per CLAUDE.md: test at 380px viewport in DevTools before claiming done.
