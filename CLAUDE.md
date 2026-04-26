# CLAUDE.md

## Always read these at the start of a task
- PLAN.md — full spec, milestones, schema, working agreement

## Project rules
- Stack: Next.js 15 (App Router) + TypeScript strict + Tailwind 4 + Drizzle + Supabase + Clerk + Resend
- Package manager: pnpm only — never npm or yarn
- Always run `pnpm lint && pnpm build` before claiming a milestone is done
- Do not add new dependencies without asking first
- Do not change the data schema (PLAN.md section 5) without asking and updating PLAN.md first
- Do not add features beyond PLAN.md section 6 or 7 without asking — defer to v2 wishlist (section 13)
- After every milestone: `git add -A` → show me `git status` → wait for commit approval → commit `mN: <description>` → push

## Mobile-first
This is a phone app at 380px viewport. Build mobile-first, then enhance for desktop. Test mobile view in DevTools before saying anything is "done."

## Speed > polish
Every interaction should feel instant. Optimistic UI updates everywhere. Network can take its time, but the user shouldn't wait for it.