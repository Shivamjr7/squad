import Link from "next/link";

export const metadata = {
  title: "Delete your account — Squad",
  description:
    "Delete your Squad account and all associated data. Self-serve from the You tab — instant and permanent.",
};

export default function DeleteAccountPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>
      <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
        Delete your account
      </h1>

      <p className="text-base leading-relaxed text-ink">
        Account deletion is self-serve and immediate. Two simple steps from the
        app:
      </p>

      <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-paper">
            Primary
          </span>
          <h2 className="font-serif text-xl text-ink">From the app</h2>
        </div>
        <ol className="ml-5 list-decimal space-y-1 text-sm leading-relaxed text-ink">
          <li>Sign in and open any circle.</li>
          <li>
            Tap <span className="font-medium">You</span> in the bottom bar.
          </li>
          <li>
            Scroll to{" "}
            <span className="font-medium">Account → Delete account</span> and
            confirm.
          </li>
        </ol>
        <p className="text-sm text-ink-muted">
          Deletion is immediate and permanent — your account is gone before the
          confirmation dialog closes.{" "}
          <Link
            href="/sign-in"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            Sign in to start
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">What gets deleted</h2>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-ink">
          <li>Your name, email, and avatar</li>
          <li>Your votes, comments, and time / venue suggestions</li>
          <li>Your circle memberships</li>
          <li>Push notification subscriptions tied to your devices</li>
          <li>Your in-app notification history</li>
        </ul>

        <h2 className="mt-4 font-serif text-2xl text-ink">What is kept</h2>
        <p className="text-sm leading-relaxed text-ink">
          Plans you created stay live, with your name removed — the rest of the
          squad still needs them. Historical receipt entries (who voted, who
          suggested) survive as <span className="italic">someone</span> rather
          than your name.
        </p>

        <p className="text-sm text-ink-muted">
          Deletion is immediate and permanent. There is no undo.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-ink/10 px-5 py-4">
        <h2 className="font-serif text-base text-ink">Need help?</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          If you can&apos;t access the app for any reason, email{" "}
          <a
            href="mailto:shivamjr7@gmail.com?subject=Delete%20my%20Squad%20account"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            shivamjr7@gmail.com
          </a>{" "}
          from the address tied to your Squad account and we&apos;ll delete it
          within 7 days. The in-app path above is faster.
        </p>
      </section>

      <p className="text-sm text-ink-muted">
        See our{" "}
        <Link
          href="/privacy"
          className="text-coral-strong underline-offset-2 hover:underline"
        >
          privacy policy
        </Link>{" "}
        for the full data picture.
      </p>
    </main>
  );
}
