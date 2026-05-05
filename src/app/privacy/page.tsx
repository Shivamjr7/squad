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
        <a href="mailto:shivam@squad.app" className="text-coral underline-offset-2 hover:underline">
          shivam@squad.app
        </a>{" "}
        to delete your account.
      </p>
      <p className="text-sm text-ink-muted">
        Account deletion is a hard delete — your votes, comments, and memberships go with the account. Plans you created are kept (the rest of the squad still needs them) with your name removed.
      </p>
    </main>
  );
}
