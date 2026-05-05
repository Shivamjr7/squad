export function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-ink/8 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col gap-4 md:max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            How it works
          </p>
          <h2 className="font-serif text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-ink sm:text-5xl md:text-6xl">
            Three taps.
            <br />
            <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
              One answer.
            </span>
          </h2>
          <p className="text-base leading-relaxed text-ink-muted">
            The plan stops drifting.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          <Step
            n="01"
            title="Drop a plan."
            body="Pick a squad. Pick a window — 2 hours, tonight, this weekend. Squad sends a single decision card to everyone."
          />
          <Step
            n="02"
            title="Squad votes."
            body="Everyone hits in / maybe / out. Counter-propose a time or venue without forking a thread. The card updates live."
          />
          <Step
            n="03"
            title="It locks."
            body="Hit consensus or hit the deadline — the plan locks. Calendar invite, directions, lock-screen widget. Done."
          />
        </ol>
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-ink/8 bg-paper-card p-6">
      <span className="font-serif text-3xl text-coral">{n}</span>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}
