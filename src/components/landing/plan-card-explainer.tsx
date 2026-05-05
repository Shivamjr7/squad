export function LandingPlanCardExplainer() {
  return (
    <section className="border-b border-ink/8 py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 md:grid-cols-[1fr_1fr] md:items-center md:gap-20">
        <div className="flex flex-col gap-6 md:order-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            The plan card
          </p>
          <h2 className="font-serif text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-ink sm:text-5xl md:text-6xl">
            One source of{" "}
            <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
              truth.
            </span>
          </h2>
          <p className="text-base leading-relaxed text-ink-muted">
            Every plan is a single living card. The time updates, the venue updates, the count updates — but the card stays put. No more “wait, scroll up, what did Karan say at 3pm?”
          </p>
          <p className="text-sm leading-relaxed text-ink-muted/85">
            It’s the bit a chat app fundamentally can’t do: hold a piece of structured state in front of everyone, and let the conversation happen around it.
          </p>

          <ul className="mt-2 grid grid-cols-2 gap-3">
            <Mini title="Auto-expires" body="Plans without a deadline go stale." />
            <Mini title="Locks on consensus" body="Hit 5 yes? Plan is on." />
            <Mini title="Counter-proposals" body="Suggest 8pm without forking the thread." />
            <Mini title="Maps + calendar" body="One tap from “in” to walking directions." />
          </ul>
        </div>

        <BigCard />
      </div>
    </section>
  );
}

function Mini({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-xl border border-ink/8 bg-paper-card p-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function BigCard() {
  return (
    <div className="md:order-1">
      <div className="mx-auto w-full max-w-sm rounded-3xl bg-paper-card p-6 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_30px_60px_-30px_rgba(20,15,10,0.22)]">
        <div className="mb-4 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-soft px-2.5 py-1 text-coral">
            <span aria-hidden className="size-1.5 rounded-full bg-coral" /> Deciding · 14m
          </span>
          <span>Sat · 6 people</span>
        </div>
        <h3 className="mb-1 font-serif text-3xl font-normal leading-tight text-ink">Movie</h3>
        <p className="mb-5 text-sm text-ink-muted">8 PM tonight · Roxie Theater</p>

        <div className="mb-5 flex h-2 overflow-hidden rounded-full bg-paper">
          <span className="h-full w-[50%] bg-in" />
          <span className="h-full w-[16%] bg-maybe" />
          <span className="h-full w-[16%] bg-out" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button type="button" className="rounded-xl bg-in/10 py-2 text-sm font-semibold text-in">In</button>
          <button type="button" className="rounded-xl bg-maybe/15 py-2 text-sm font-semibold text-maybe">Maybe</button>
          <button type="button" className="rounded-xl bg-out/10 py-2 text-sm font-semibold text-out">Out</button>
        </div>

        <ul className="mt-5 space-y-2 text-xs text-ink-muted">
          <li className="flex justify-between"><span><span className="text-coral">Karan</span> in for 8:30</span><span>· 2m</span></li>
          <li className="flex justify-between"><span><span className="text-coral">Anya</span> counter-proposed Bar Tartine</span><span>· 5m</span></li>
        </ul>
      </div>
    </div>
  );
}
