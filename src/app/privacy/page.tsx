import Link from "next/link";

export const metadata = {
  title: "Privacy — Squad",
  description:
    "What Squad collects, who processes it, how long we keep it, and how to delete your account.",
};

// Last reviewed when this file was last meaningfully changed. Update the
// date when content changes — the date itself is referenced from
// /delete-account and is what Play Store reviewers look for.
const LAST_UPDATED = "May 22, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
          Privacy
        </h1>
        <p className="text-xs uppercase tracking-wider text-ink-muted">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      <p className="text-base leading-relaxed text-ink">
        Squad is a small app for friend groups to coordinate plans. We
        collect the minimum needed to run that, store it in one Postgres
        database, and delete it on request. No advertising, no analytics
        broker, no resale.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">What we collect</h2>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-ink">
          <li>
            <strong>From Google (via Clerk):</strong> your display name,
            email, and avatar URL.
          </li>
          <li>
            <strong>From you:</strong> plans, votes, comments, time and
            venue suggestions, optional circle home location, push
            notification preference.
          </li>
          <li>
            <strong>Generated automatically:</strong> per-device push
            subscription tokens (when you opt in), a server-side log of
            place-search calls used to build the Suggest drawer, and
            short-lived rate-limit counters keyed to your user id.
          </li>
          <li>
            <strong>Not collected:</strong> precise location (only used
            client-side and only if you grant the browser prompt),
            advertising identifiers, browsing outside Squad, payment
            info.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Who processes it</h2>
        <p className="text-sm leading-relaxed text-ink">
          Squad runs on a small set of vendors. None of them get the data
          to use for their own purposes:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-ink">
          <li>
            <strong>Clerk</strong> — sign-in and session management. Holds
            your Google email/avatar copy.
          </li>
          <li>
            <strong>Supabase (Postgres + Realtime)</strong> — the only
            database. Plans, votes, comments, push tokens live here.
          </li>
          <li>
            <strong>Resend</strong> — transactional emails (plan
            confirmation, cancellation, reminders).
          </li>
          <li>
            <strong>Google Places</strong> — venue autocomplete suggestions
            (your typed query is sent to Google; results are cached
            server-side so the same query doesn&apos;t leave us twice).
          </li>
          <li>
            <strong>Vercel</strong> — hosting + privacy-respecting Web
            Analytics (page view counts only, no fingerprinting).
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">How long we keep it</h2>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-ink">
          <li>
            Account, plans, votes, comments: until you delete your account.
          </li>
          <li>
            Push subscription tokens: until you turn pushes off, your
            browser revokes the subscription, or you delete the account.
          </li>
          <li>
            Suggest-drawer logs: 180 days, auto-purged daily.
          </li>
          <li>
            Rate-limit counters: 24 hours.
          </li>
          <li>
            Email logs in Resend: per Resend&apos;s retention (typically
            30&nbsp;days).
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Your rights</h2>
        <p className="text-sm leading-relaxed text-ink">
          You can delete your account at any time —{" "}
          <Link
            href="/delete-account"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            getsquad.in/delete-account
          </Link>
          . Deletion is immediate and cascades: votes, comments,
          memberships, push subscriptions, in-app notification history,
          and your name/email/avatar all go. Plans you created stay with
          your name removed so the rest of the squad doesn&apos;t lose
          context.
        </p>
        <p className="text-sm leading-relaxed text-ink">
          Under GDPR (EU/UK) and CCPA (California) you also have rights
          to access, correct, and export your data, and to opt out of any
          sale of personal information. Squad does not sell personal
          information. For access, correction, or export requests, email
          us — turnaround is 30 days.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Children</h2>
        <p className="text-sm leading-relaxed text-ink">
          Squad is for people 13 and older. We don&apos;t knowingly
          collect data from anyone younger; if you believe a child has
          created an account, email us and we&apos;ll delete it. See our{" "}
          <Link
            href="/child-safety"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            child safety standards
          </Link>{" "}
          for our zero-tolerance policy on CSAE and reporting channels.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Contact</h2>
        <p className="text-sm leading-relaxed text-ink">
          Email{" "}
          <a
            href="mailto:shivamjr7@gmail.com"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            shivamjr7@gmail.com
          </a>{" "}
          with any privacy questions or requests.
        </p>
      </section>
    </main>
  );
}
