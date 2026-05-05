import { SignUpButton } from "@clerk/nextjs";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden border-b border-ink/8">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-12 pb-16 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-16 md:pt-20 md:pb-24">
        <div className="flex flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-ink/10 bg-paper-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-coral" />
            are we still on?
          </span>
          <h1 className="font-serif text-[44px] font-normal leading-[0.98] tracking-[-0.02em] text-ink sm:text-[56px] md:text-[68px]">
            Stop scrolling.
            <br />
            Start{" "}
            <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
              showing up.
            </span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-ink-muted sm:text-lg">
            A small group converges on a yes/no/maybe in a short window. WhatsApp loses decisions in scrollback — Squad keeps the current state of a plan as the source of truth.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SignUpButton mode="modal">
              <button className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/90">
                Get Squad — free
              </button>
            </SignUpButton>
            <a
              href="#how-it-works"
              className="rounded-full border border-ink/15 bg-paper-card px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper"
            >
              See how it works
            </a>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative grid grid-cols-2 gap-3 md:gap-4">
      {/* WhatsApp-style scrollback */}
      <div className="rotate-[-2deg] rounded-2xl bg-paper-card p-3 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_24px_48px_-24px_rgba(20,15,10,0.18)] sm:p-4">
        <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          <span>The Squad <span aria-hidden>🎉</span></span>
          <span>2:14</span>
        </div>
        <p className="mb-3 text-[10px] text-ink-muted">Karan, Mira, Ravi, Anya, +2</p>
        <ul className="space-y-2 text-xs text-ink">
          <Bubble who="Mira">anyone free today?</Bubble>
          <Bubble who="Karan">yes</Bubble>
          <Bubble who="Ravi">let me check</Bubble>
          <Bubble who="Mira">movie? 7pm?</Bubble>
          <Bubble who="Anya">can we do 8 instead</Bubble>
          <Bubble who="Karan">ooh dinner first?</Bubble>
          <Bubble who="Theo">i&apos;m out tn</Bubble>
          <Bubble who="Ravi">where though</Bubble>
          <Bubble who="Mira">roxie?</Bubble>
        </ul>
        <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          vs.
        </p>
      </div>

      {/* Squad plan card */}
      <div className="self-center rotate-[2deg] rounded-2xl bg-paper-card p-4 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_24px_48px_-24px_rgba(20,15,10,0.22)] sm:p-5">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-in-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-in">
          <span aria-hidden>✓</span> Decided · 4 in
        </div>
        <h3 className="mb-3 font-serif text-2xl font-normal leading-tight text-ink sm:text-3xl">
          Movie
        </h3>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between">
            <dt className="font-semibold uppercase tracking-[0.14em] text-ink-muted">When</dt>
            <dd className="font-medium text-ink">8:30 PM</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-semibold uppercase tracking-[0.14em] text-ink-muted">Where</dt>
            <dd className="font-medium text-ink">Roxie</dd>
          </div>
        </dl>
        <div className="mt-4 flex -space-x-1">
          {["bg-in", "bg-in", "bg-in", "bg-in", "bg-out", "bg-maybe"].map((c, i) => (
            <span
              key={i}
              className={`inline-block size-5 rounded-full ${c} ring-2 ring-paper-card`}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Bubble({ who, children }: { who: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col">
      <span className="text-[10px] font-medium text-coral">{who}</span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}
