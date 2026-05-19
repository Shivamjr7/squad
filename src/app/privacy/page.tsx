import Link from "next/link";

export const metadata = {
  title: "Privacy — Squad",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>
      <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
        Privacy
      </h1>
      <p className="text-base leading-relaxed text-ink">
        We store your name, email, and avatar from Google. We store the plans, votes, and comments you create. We don’t share data with anyone. Email{" "}
        <a href="mailto:shivamjr7@gmail.com" className="text-coral-strong underline-offset-2 hover:underline">
          shivamjr7@gmail.com
        </a>{" "}
        with any privacy questions.
      </p>
      <p className="text-sm text-ink-muted">
        To delete your account, visit{" "}
        <Link href="/delete-account" className="text-coral-strong underline-offset-2 hover:underline">
          getsquad.in/delete-account
        </Link>
        . Deletion is a hard delete — your votes, comments, and memberships go with the account. Plans you created are kept (the rest of the squad still needs them) with your name removed.
      </p>
      <p className="text-sm text-ink-muted">
        See our{" "}
        <Link href="/child-safety" className="text-coral-strong underline-offset-2 hover:underline">
          child safety standards
        </Link>{" "}
        for our zero-tolerance policy on CSAE and reporting channels.
      </p>
    </main>
  );
}
