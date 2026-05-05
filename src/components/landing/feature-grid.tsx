export function LandingFeatureGrid() {
  return (
    <section id="features" className="border-b border-ink/8 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="md:max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Built for the question
          </p>
          <h2 className="mt-4 font-serif text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-ink sm:text-5xl md:text-6xl">
            Are we still{" "}
            <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
              on?
            </span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            Six small features that, together, do exactly one thing: get a small group to a yes/no/maybe before the night ends.
          </p>
        </div>

        <ul className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Feature title="Three-state RSVP" body="In, maybe, or out. No “haha 👍” ambiguity — just a count everyone can read at a glance.">
            <div className="flex gap-1.5">
              <Pill bg="bg-in/10" fg="text-in">IN · 4</Pill>
              <Pill bg="bg-maybe/15" fg="text-maybe">MAYBE · 1</Pill>
              <Pill bg="bg-out/10" fg="text-out">OUT · 1</Pill>
            </div>
          </Feature>

          <Feature title="Time consensus heatmap" body="Tap the hours you’re free. Squad picks the one where the most of you overlap — no more 7→8→8:30 slide.">
            <div className="grid grid-cols-6 gap-1">
              {[2, 3, 5, 6, 4, 2].map((c, i) => (
                <span
                  key={i}
                  className="aspect-square rounded-md"
                  style={{ background: `color-mix(in oklab, var(--in) ${c * 16}%, var(--paper))` }}
                  aria-hidden
                />
              ))}
            </div>
            <div className="mt-1 grid grid-cols-6 gap-1 text-[9px] font-medium uppercase tracking-wide text-ink-muted">
              <span className="text-center">6p</span><span className="text-center">7p</span><span className="text-center">8p</span><span className="text-center">9p</span><span className="text-center">10p</span><span className="text-center">11p</span>
            </div>
          </Feature>

          <Feature title="Auto-locking decisions" body="Hit your consensus threshold or your deadline — the plan freezes. The decision lives past scrollback.">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper">
              <span aria-hidden>🔒</span> Locked
            </div>
          </Feature>

          <Feature title="Venue voting" body="Swipe through options. The card surfaces the winner without three pages of “i mean i’m down for whatever”.">
            <div className="space-y-1.5">
              <Venue name="Roxie" votes="3" leading />
              <Venue name="Bar Tartine" votes="2" />
              <Venue name="Karan’s" votes="1" />
            </div>
          </Feature>

          <Feature title="Counter-proposals" body="Disagree without forking. Stack alternative plans on the same card; the squad votes; the winner becomes the plan.">
            <div className="rounded-lg border border-dashed border-ink/15 px-3 py-2 text-xs">
              <p className="text-ink-muted"><span className="text-coral">Anya</span> · 9 PM instead?</p>
              <p className="mt-1 text-ink-muted/80">2 votes · 12m left</p>
            </div>
          </Feature>

          <Feature title="Lock-screen widget" body="The plan, the count, the time — visible without unlocking. The chat app you’re already ignoring stays ignored.">
            <div className="rounded-xl bg-ink p-3 text-paper">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/60">Squad</p>
              <p className="mt-1 text-xs">It’s happening — 8:30 at Roxie</p>
              <p className="mt-1 text-[10px] text-paper/60">Karan: in for 8:30</p>
            </div>
          </Feature>
        </ul>
      </div>
    </section>
  );
}

function Feature({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-ink/8 bg-paper-card p-5">
      <div className="flex h-20 items-end">{children}</div>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${bg} ${fg}`}>
      {children}
    </span>
  );
}

function Venue({ name, votes, leading = false }: { name: string; votes: string; leading?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md px-2.5 py-1 text-xs ${leading ? "bg-in/10 text-in" : "bg-paper text-ink-muted"}`}>
      <span className="font-medium">{name}</span>
      <span>{votes}</span>
    </div>
  );
}
