# ANDROID_PLAN.md — Squad on Google Play

> Spec for shipping the existing Next.js PWA as an Android app on Google Play Store via Bubblewrap (TWA). Read in order. One phase at a time.

## 0. Decision summary

| Question | Decision | Why |
|---|---|---|
| Native rebuild or TWA wrapper? | **TWA via Bubblewrap** | App is already a polished PWA (manifest, sw.js, push, offline shell, install banner). TWA ships the same web app inside a Chrome-backed Android shell. Zero native code. PLAN.md §13 listed "Capacitor wrapper" as v2 — TWA is lighter. |
| Reuse `squad-android/`? | **Yes** | `twa-manifest.json` is configured, `android.keystore` exists, `app-release-bundle.aab` v2 was already built. Just needs domain + asset updates + a re-build. |
| Logo? | **Polish the existing three-dots mark** (per user). Coral triangle of dots, paper background. Generate Android adaptive icon (foreground + background layers) and a Play Store 512×512. |
| Domain? | **Custom domain before first Play upload.** Saves a forced app update + assetlinks regen + Clerk reconfig later. |
| Release track? | **Internal testing → Closed → Production** (recommended; revisit when ready). |

PLAN.md §3 lists "iOS/Android native app" as a v1 non-goal — TWA wrapper is closer to "PWA install" than a native rebuild, but PLAN.md should be amended (small note in §6/§7) to acknowledge Play distribution.

---

## 1. Domain shortlist (under ₹1000/yr)

Checked via `whois` on 2026-05-17. `.in` domains are typically ₹500-800/yr first year and renewal at Namecheap / GoDaddy IN / BigRock. `.com` ~₹830-1250/yr — tight but possible. `.app`, `.fyi`, `.life` are >₹1000/yr and many are taken (squad.app, squad.fyi, squad.life, squadly.app — all taken).

**Available `.in` (within budget, recommended):**
- `getsquad.in` ✅
- `usesquad.in` ✅
- `plansquad.in` ✅
- `squadplan.in` ✅
- `onsquad.in` ✅
- `squadnow.in` ✅
- `squadclub.in` ✅
- `chaisquad.in` ✅ (on-brand for Indian friend-group context)
- `squadcrew.in` ✅
- `oursquad.in` ✅
- `weeksquad.in` ✅
- `squadtonight.in` ✅ (matches landing copy "Tonight, *squad*?")
- `squadweekend.in` ✅
- `friendsquad.in` ✅

**Top picks** (subjective, lean Indian friend-group context per PLAN.md §1):
1. **`getsquad.in`** — short, action-verb, easiest to dictate over WhatsApp ("install getsquad dot in")
2. **`chaisquad.in`** — culturally anchored, memorable, on-brand with PLAN.md's "chai" plan-type
3. **`squadtonight.in`** — long but echoes the exact moment the app exists for

**Taken (FYI, don't bother):** squad.app, squad.in, squad.fyi, squad.life, squad.xyz, squad.fun, mysquad.in, nightsquad.in, squadhq.in, squadly.in, squadup.in, getsquad.com, trysquad.com/in, plansquad.com, squadplan.com, onsquad.com, joinsquad.in.

**Where to buy:** Cloudflare Registrar is at-cost (no markup) but doesn't sell `.in`. For `.in` use Namecheap, GoDaddy, or BigRock. Pay yearly only — don't auto-bundle privacy add-ons.

---

## 2. Phased plan

Each phase ends with a working state. Don't start the next until previous is green.

### Phase 1 — Domain + DNS (you do, ~30 min)
1. Buy your chosen domain (see §1).
2. In Vercel project → Settings → Domains → add the domain → follow the DNS instructions (typically an A record `@ → 76.76.21.21` and CNAME `www → cname.vercel-dns.com`).
3. Wait for SSL to issue (usually 1-5 min after DNS resolves).
4. Confirm `https://<your-domain>/` serves the app.
5. Tell me the final domain. I'll do the rest.

### Phase 2.5 — Clerk Production migration (DEFERRED — needs Clerk Pro $25/mo)

Clerk's Development instance always routes OAuth through `accounts.<x>.dev`, so the Google consent screen reads "Sign in to accounts.dev" instead of "Sign in to Squad" regardless of custom GCP OAuth credentials. Fix requires a Clerk **Production** instance + custom Clerk domain (e.g. `clerk.getsquad.in`) — and custom domain is gated behind Clerk Pro.

**Decision (2026-05-17):** ship Internal Test track on Clerk **Development** instance. Migrate to Pro before promoting to Production track on Play Store.

**Limitations of staying on dev for now:**
- Rate caps ~1000 ops/day. Fine for friend-group test.
- "accounts.dev" consent screen on Google sign-in. Cosmetic.
- Clerk reserves right to wipe dev instance data. Backup periodically before launch.
- Some Android security scanners may flag the `.dev` redirect.

**Migration when ready (~45 min):**
1. Upgrade Clerk to Pro plan.
2. Create Production instance → add `clerk.getsquad.in` as custom domain (CNAME records at Namecheap).
3. Paste GCP OAuth client credentials into prod instance's Social Connections → Google.
4. Add `https://clerk.getsquad.in/v1/oauth_callback` to GCP OAuth client's authorized redirect URIs.
5. Swap Vercel env vars: `pk_test_*` → `pk_live_*`, `sk_test_*` → `sk_live_*`.
6. Wipe dev `users` table (dev/prod user pools are separate; pre-launch this is acceptable loss).
7. Redeploy + verify consent screen reads "Sign in to Squad".

GCP OAuth Client ID + Branding (App name "Squad", logo, getsquad.in authorized domain) are already configured. They'll activate cleanly the moment Clerk Pro is in place.

### Phase 2 — Web app domain reconfig (Claude, ~1 evening)
- Update `public/manifest.webmanifest` `start_url` + `scope` if absolute URLs are anywhere.
- Update `next.config.mjs` (image/og domains).
- Update **Clerk dashboard**: add new domain to allowed origins + OAuth redirect URLs (`/sign-in/sso-callback`, etc).
- Update **Resend**: add domain to verified senders if email links currently point to vercel.app.
- Update **Supabase**: any redirect URLs in auth settings.
- Update **VAPID / Web Push**: subject (`mailto:` is fine but if domain-based, update); existing push subscriptions on `squad-silk.vercel.app` will not transfer — users on the old domain re-subscribe automatically on first visit to the new domain.
- Update OG image, sitemap, robots, any hardcoded URLs in email templates.
- Validate: `pnpm lint && pnpm build` → push → smoke test sign-in + create plan + push.
- `squad-silk.vercel.app` stays as a Vercel alias so old PWA installs keep working until users migrate.

### Phase 3 — Logo + splash polish (Claude, ~1 evening)
Existing brandmark: three coral dots (#FF7B4D) in a triangle on slate (#15151C) — keep concept, regenerate at proper resolutions.
- **Generate adaptive icon layers** (Android 8+): `ic_launcher_foreground.png` (432×432, dots only, no bg, transparent), `ic_launcher_background.png` (108×108 solid slate). Place in `squad-android/app/src/main/res/mipmap-*/`. Bubblewrap takes the maskable as input.
- **Maskable icon**: ensure `public/icon-maskable-512.png` keeps the dots inside the 80% safe-zone (current version is fine — verify on maskable.app).
- **Splash**: Bubblewrap renders splash from `iconUrl` + `backgroundColor`. Currently `#F5F0EA` (paper). Confirm the icon renders crisp on paper. Bump `splashScreenFadeOutDuration` only if it feels abrupt.
- **First-paint logo on cold load**: `app/(signed-out)/page.tsx` (or whatever currently serves `/` for unauthenticated users) renders `<SquadLogo>` as the very first DOM element — so TWA splash → web first-paint shows the same mark, no flash.
- **Play Store icon**: 512×512 PNG, no transparency, no rounded corners (Play applies its own mask). Export from `icon-512.png` source.

### Phase 4 — Login page redesign (Claude, ~half an evening)
Current `/sign-in` is the raw Clerk `<SignIn>` component on white. Replace with:
- Paper background (`#F5F0EA`), matches splash → no color flash post-launch.
- Logo top-center (32px).
- Serif headline: "are we still on?" (Source Serif 4, large display).
- Body: "Sign in to join your squad."
- Clerk `<SignIn>` mounted below with `appearance` tokens overriding the Google button to coral border / ink text.
- Footer micro-copy: "Free for groups up to 8. Invite-only."

Reach: this replaces `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`. Sign-up gets the same treatment for parity.

### Phase 5 — Bubblewrap rebuild + Play upload (you + Claude, ~1 evening)
1. `cd squad-android`
2. Edit `twa-manifest.json`: `host`, `iconUrl`, `maskableIconUrl`, `webManifestUrl`, `fullScopeUrl` → all point at new domain. Bump `appVersionCode: 3`, `appVersionName: "3"`, `appVersion: "3"`.
3. Generate Digital Asset Links file at `public/.well-known/assetlinks.json` in the Next.js app:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "app.squad.twa",
       "sha256_cert_fingerprints": ["6A:2E:4E:45:9A:F7:FC:45:E0:77:91:91:7D:9D:5B:FB:8B:D2:1E:2B:DB:12:FA:6E:BE:B8:B0:74:C6:49:37:E3"]
     }
   }]
   ```
   Verify `https://<your-domain>/.well-known/assetlinks.json` returns 200 + correct JSON before next step. (Critical — wrong fingerprint = Chrome URL bar shows in the app.)
4. `bubblewrap update` (picks up the manifest changes).
5. `bubblewrap build` (regenerates `app-release-bundle.aab` and signed APK).
6. Sanity-install: `adb install app-release-signed.apk` on a real Android device. Confirm: no URL bar, push permission prompt works, Google sign-in completes, create plan + vote works.
7. Play Console upload (see §3).

### Phase 6 — Play Console listing (you, ~1-2 hours)
See §3 below for exact copy + assets.

### Phase 7 — Internal test → Production
1. Upload AAB to **Internal testing** track.
2. Add yourself + 2-3 friends via Play Console testers list.
3. Install via the testing opt-in link, validate on 2 different Android devices.
4. After 24-48h of green, promote release to **Production**.
5. First production review: typically 1-7 days. Subsequent updates: usually a few hours.

---

## 3. Play Store listing (ready-to-paste copy)

Extracted + adapted from `Squad Mobile Landing _standalone_.html` and PLAN.md.

**App name:** Squad
**Short description (80 chars):**
> The tiny app for "are we still on?" Stop scrolling. Start showing up.

**Full description (≤4000 chars):**
> Squad is a tiny app for the question your friends keep losing in the WhatsApp scrollback: are we still on?
>
> One living plan card holds the time, the place, and who's in — so you stop typing and start showing up.
>
> THREE TAPS
> • Drop a plan. Pick a window — tonight, this weekend, in 2 hours. One card goes to everyone.
> • Squad votes. Tap In, Maybe, or Out. Counter-propose a time or venue without forking a thread.
> • It locks. Consensus or deadline — the plan freezes. Lives on the home screen until you walk out the door.
>
> SIX SMALL FEATURES, ONE QUESTION
> • Three-state RSVP. The count is the answer.
> • Time consensus. Tap the hours you're free. Squad finds the slot where the most of you overlap.
> • Counter-proposals. Stack alternatives on the same card. The squad votes. The winner becomes the plan.
> • Plan locks on a deadline. No more drift to "let's decide tomorrow."
> • Calendar + Maps deep-links. Add to calendar in a tap. Walking directions surface on the locked card.
> • Push when it matters. New plan, about-to-lock, 45 min before you should leave. Nothing else.
>
> SQUAD IS NOT A CHAT APP. THAT'S THE WHOLE POINT.
> Group chats are great at typing. Bad at deciding. Squad is the opposite — opinionated about getting to a plan, indifferent to your hot takes.
>
> FREE FOR GROUPS UP TO 8 · INVITE-ONLY · NO ADS · NO TRACKING
>
> Privacy: we store your name, email and avatar from Google, plus the plans, votes and comments you create. We don't share data with anyone. Read the full policy at <your-domain>/privacy.

**What's new (release notes for v3):**
> First Play Store release. Three-state RSVP, time consensus voting, counter-proposals, push notifications, lock-screen-ready plan cards.

**Category:** Social
**Tags:** social, lifestyle, productivity
**Content rating:** Everyone (no UGC moderation issues at scale-of-friend-groups; revisit if circles grow)
**Contact email:** shivamjr7@gmail.com (or a dedicated one)
**Privacy policy URL:** `https://<your-domain>/privacy` (exists)

**Assets required:**
| Asset | Size | Source |
|---|---|---|
| App icon | 512×512 PNG, no alpha | Re-export from `public/icon-512.png` |
| Feature graphic | 1024×500 PNG | Create: paper bg + 3-dot mark + serif headline "are we still on?" |
| Phone screenshots | min 2, max 8 — 1080×1920 or 1080×2400 | Capture from real device or DevTools: (1) home with featured plan, (2) plan detail "deciding now", (3) locked plan card, (4) time consensus heatmap, (5) sign-in |
| Tablet screenshots | optional | Skip for v1 — mobile-first |
| Short video | optional | Skip for v1 |

---

## 4. Once you buy the domain — exact steps

The moment your DNS resolves, ping me with the domain. Then:

**You do (15 min):**
1. In your registrar's DNS panel, follow Vercel's exact records (Vercel shows them in Project → Domains → Add).
2. Wait for green checkmark next to the domain in Vercel.
3. Open `https://<your-domain>/` — confirm the app loads with valid HTTPS.

**I do (rest of the work):**
4. Update all in-code references + manifests (Phase 2 above).
5. Update Clerk allowed origins + redirect URLs (I'll show you the exact dashboard clicks — Clerk is the one thing I can't do via code).
6. Polish the logo set + splash (Phase 3).
7. Redesign sign-in (Phase 4).
8. Bump `twa-manifest.json`, regenerate AAB (Phase 5). I'll walk through each command.
9. Write `assetlinks.json`, verify it serves on the new domain.
10. Hand you the signed AAB + the Play Console copy from §3, and you upload.

You only need to be hands-on for: buying the domain, Clerk dashboard clicks, Play Console upload, real-device test.

---

## 5. How updates work after Play launch

The big win of the TWA approach:

| Type of change | Ships how? | Time |
|---|---|---|
| UI tweak, copy change, bug fix, new feature, schema change | `git push` → Vercel deploy | **Instant.** Zero Play involvement. Users see it next time they open the app. |
| Push notification logic | Same — server-side via Supabase Edge Function | Instant after deploy. |
| New app icon, splash, package name, OS-level permissions | New AAB → Play Console upload → review | ~few hours to 2 days for review, then auto-updates on user devices over 24-48h. |
| Update Android targetSdk (Google forces a bump ~yearly) | `bubblewrap update` → new AAB → upload | ~1 hr work, few hours review. Google emails reminders 3+ months out. |
| Change startUrl (e.g. another domain switch) | New AAB with new manifest → upload | ~1 hr work + the forced-update pain on user side. **Avoid by picking the right domain now.** |

**Practical rhythm:** 95% of changes never touch Play. You ship a new AAB maybe 2-4× per year — for icon refreshes, targetSdk bumps, or notable native-feeling changes worth a "v4 — now with…" release note.

The reason this matters: the alternative (Capacitor or React Native rebuild) would gate **every** UI change on a Play review cycle. TWA dodges that entirely.

---

## 6. Risks + watch-outs

- **`assetlinks.json` mistake.** Wrong fingerprint, wrong package name, or wrong content-type and the TWA opens with a Chrome URL bar at the top — looks unprofessional. Validate on https://developers.google.com/digital-asset-links/tools/generator after publishing.
- **Clerk OAuth on new domain.** Google sign-in via Clerk needs the new domain whitelisted in both Clerk dashboard AND Google Cloud Console (OAuth consent screen + authorized redirect URIs). Miss the second one and sign-in 400s.
- **Old Vercel domain still in user data.** Push subscriptions on `squad-silk.vercel.app` won't transfer. Don't delete the alias for at least 3 months — old PWA installs there will silently re-subscribe on new domain once user reopens.
- **PLAN.md amendment.** §3 lists "iOS/Android native app" as a non-goal. Add a line acknowledging TWA distribution doesn't violate this (it's a wrapper, not a rebuild). I'll PR that change alongside Phase 2.
- **Play account fee.** $25 one-time developer registration if you don't have a Play Console account already.

---

## 7. Open questions (decide when ready)

- Final domain (need before Phase 2).
- Release track for first upload — Internal first vs. straight to Production.
- Custom email contact for store listing, or use your personal Gmail?
- Privacy policy URL — confirm `/privacy` on the new domain is the canonical link (it already exists in the app).
