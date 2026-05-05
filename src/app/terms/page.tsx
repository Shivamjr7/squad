import Link from "next/link";

export const metadata = {
  title: "Terms — Squad",
};

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>
      <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
        Terms
      </h1>
      <p className="text-base leading-relaxed text-ink">
        Squad is a small app for small groups. Don’t use it to harass anyone, don’t scrape it, and don’t resell it. We can suspend accounts that do.
      </p>
      <p className="text-base leading-relaxed text-ink">
        We don’t make any uptime promises in v1 — this is run by one person on a free hosting tier. Use it because it’s useful, not because it’s critical.
      </p>
      <p className="text-sm text-ink-muted">
        Questions: <a href="mailto:shivam@squad.app" className="text-coral underline-offset-2 hover:underline">shivam@squad.app</a>.
      </p>
    </main>
  );
}
