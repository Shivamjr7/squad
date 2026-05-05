import { SignUpButton } from "@clerk/nextjs";

export function LandingFinalCta() {
  return (
    <section className="border-b border-ink/8 py-24 md:py-32">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Stop scrolling
        </p>
        <h2 className="font-serif text-5xl font-normal leading-[1.02] tracking-[-0.02em] text-ink sm:text-6xl md:text-7xl">
          Be the squad that
          <br />
          <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
            actually
          </span>{" "}
          shows up.
        </h2>
        <p className="max-w-xl text-base leading-relaxed text-ink-muted">
          Free for groups up to 8. Works on iOS and Android. No accounts, just your phone number — like the chat app it’s quietly replacing.
        </p>

        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          <SignUpButton mode="modal">
            <button className="rounded-full bg-ink px-7 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/90">
              Get Squad — free
            </button>
          </SignUpButton>
          <SignUpButton mode="modal">
            <button className="rounded-full border border-ink/15 bg-paper-card px-7 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper">
              Open on the web
            </button>
          </SignUpButton>
        </div>

        <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-muted">
          <li>Free forever for small groups</li>
          <li aria-hidden>·</li>
          <li>iOS 16+ / Android 12+</li>
          <li aria-hidden>·</li>
          <li>v1.4 · 12.4 MB</li>
        </ul>
      </div>
    </section>
  );
}
