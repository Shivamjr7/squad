import Link from "next/link";

export const metadata = {
  title: "Terms — Squad",
  description:
    "The short version: don't harass people, don't scrape the app, expect bugs.",
};

const LAST_UPDATED = "May 22, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
          Terms
        </h1>
        <p className="text-xs uppercase tracking-wider text-ink-muted">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      <p className="text-base leading-relaxed text-ink">
        Squad is a small app for small groups. By using it you agree to
        the short list below.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Eligibility</h2>
        <p className="text-sm leading-relaxed text-ink">
          You must be 13 or older to use Squad. If you&apos;re under 18,
          you confirm a parent or guardian has agreed to these terms on
          your behalf where the law requires it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Acceptable use</h2>
        <p className="text-sm leading-relaxed text-ink">
          Don&apos;t use Squad to:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-ink">
          <li>Harass, threaten, or doxx anyone.</li>
          <li>
            Post anything illegal — that includes content depicting
            child sexual abuse or exploitation (see{" "}
            <Link
              href="/child-safety"
              className="text-coral-strong underline-offset-2 hover:underline"
            >
              child safety
            </Link>
            ).
          </li>
          <li>Spam invites, plans, or comments.</li>
          <li>
            Scrape, crawl, or otherwise pull data out of the app via
            automation.
          </li>
          <li>
            Resell access, white-label the app, or imply you operate it.
          </li>
          <li>
            Attempt to probe, attack, or work around security boundaries.
            Authorised security research → email us first.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Your content</h2>
        <p className="text-sm leading-relaxed text-ink">
          You own what you post (plans, votes, comments, venue
          suggestions). You grant Squad the right to host and display
          that content to other members of your circle so the app
          functions. We don&apos;t use it for anything else.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">
          Account termination
        </h2>
        <p className="text-sm leading-relaxed text-ink">
          You can delete your account at any time from{" "}
          <Link
            href="/delete-account"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            getsquad.in/delete-account
          </Link>
          . We can suspend or delete accounts that violate these terms,
          usually after a warning unless the violation is serious (CSAE,
          targeted harassment, attempted attacks).
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">
          No warranty, limited liability
        </h2>
        <p className="text-sm leading-relaxed text-ink">
          Squad is provided as-is. We make no uptime guarantees — this is
          run by one person on a free hosting tier. To the maximum
          extent allowed by law, Squad and its operator are not liable
          for indirect, incidental, or consequential damages arising
          from your use of the app. Our total liability for direct
          damages is capped at INR 1,000.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Changes</h2>
        <p className="text-sm leading-relaxed text-ink">
          We can update these terms; the &quot;last updated&quot; date at
          the top tells you when. Material changes will be flagged in
          the app before they take effect.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl text-ink">Governing law</h2>
        <p className="text-sm leading-relaxed text-ink">
          These terms are governed by the laws of India. Disputes that
          can&apos;t be resolved over email belong to the courts of
          Hyderabad, India.
        </p>
      </section>

      <p className="text-sm text-ink-muted">
        Questions:{" "}
        <a
          href="mailto:shivamjr7@gmail.com"
          className="text-coral-strong underline-offset-2 hover:underline"
        >
          shivamjr7@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
