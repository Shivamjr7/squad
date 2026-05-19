import Link from "next/link";

export const metadata = {
  title: "Delete your account — Squad",
  description:
    "Delete your Squad account and all associated data. Two paths: in-app from You → Account, or by emailing shivamjr7@gmail.com.",
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
        You can delete your Squad account at any time. Two ways to do it:
      </p>

      <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-5 py-4">
        <h2 className="font-serif text-xl text-ink">In the app</h2>
        <p className="text-sm leading-relaxed text-ink">
          Sign in, open any circle, tap{" "}
          <span className="font-medium text-ink">You</span> in the bottom bar,
          then scroll to{" "}
          <span className="font-medium text-ink">Account → Delete account</span>
          . Confirm in the dialog and your account is gone immediately.
        </p>
        <p className="text-sm text-ink-muted">
          Need the app?{" "}
          <Link
            href="/sign-in"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            Sign in here
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-5 py-4">
        <h2 className="font-serif text-xl text-ink">By email</h2>
        <p className="text-sm leading-relaxed text-ink">
          Email{" "}
          <a
            href="mailto:shivamjr7@gmail.com?subject=Delete%20my%20Squad%20account"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            shivamjr7@gmail.com
          </a>{" "}
          from the address tied to your Squad account. We&apos;ll confirm the
          request and delete within 7 days.
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
