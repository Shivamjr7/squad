export function LandingProblem() {
  return (
    <section id="why" className="border-b border-ink/8 py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 md:grid-cols-[1fr_1fr] md:gap-20">
        <div className="flex flex-col gap-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            The way it is
          </p>
          <h2 className="font-serif text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-ink sm:text-5xl md:text-6xl">
            One{" "}
            <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
              forgotten
            </span>{" "}
            thread, three slipped hours, no plan.
          </h2>

          <ul className="mt-2 space-y-7">
            <Problem
              title="The decision disappears into scrollback"
              body="By 6pm, “did we say 8 or 8:30?” is buried under memes, pet pics, and a tangent about hot sauce."
            />
            <Problem
              title="There’s no current state"
              body="Karan is in. Ravi is “let me check.” Theo dropped 40 minutes ago. Nobody knows the count."
            />
            <Problem
              title="The clock keeps slipping"
              body="7 → 8 → 8:30 → “maybe tomorrow.” Without a deadline the plan just dissolves."
            />
          </ul>
        </div>

        <ChatStrip />
      </div>
    </section>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex flex-col gap-1.5">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function ChatStrip() {
  const lines: Array<{ who: string; t: string; msg: string }> = [
    { who: "Mira", t: "14:00", msg: "anyone free today?" },
    { who: "Karan", t: "14:02", msg: "yes" },
    { who: "Ravi", t: "14:08", msg: "let me check 🤔" },
    { who: "Mira", t: "14:31", msg: "movie at 7?" },
    { who: "Anya", t: "15:02", msg: "can we do 8 instead 🥺" },
    { who: "Karan", t: "15:14", msg: "ooh dinner first?" },
    { who: "Theo", t: "15:46", msg: "i’m out tn, sorry 🥲" },
    { who: "Mira", t: "16:11", msg: "" },
    { who: "Ravi", t: "16:22", msg: "where though" },
    { who: "Anya", t: "17:01", msg: "wait are we still on??" },
  ];
  return (
    <div className="rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_24px_48px_-24px_rgba(20,15,10,0.16)] md:p-6">
      <div className="mb-4 flex items-center justify-between border-b border-ink/8 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        <span>SAT · 14:00 → 17:00</span>
        <span>The Squad</span>
      </div>
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-12 shrink-0 pt-px text-[10px] font-medium text-ink-muted/80">
              {line.t}
            </span>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-coral">{line.who}</span>
              <span className="text-sm text-ink">
                {line.msg || <span className="text-ink-muted/50">…</span>}
              </span>
            </div>
          </li>
        ))}
        <li className="ml-15 mt-2 rounded-md bg-out-soft px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-out">
          Result: nobody showed up
        </li>
      </ul>
    </div>
  );
}
