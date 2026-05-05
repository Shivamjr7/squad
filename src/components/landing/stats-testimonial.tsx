export function LandingStatsTestimonial() {
  return (
    <section className="border-b border-ink/8 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <ul className="grid grid-cols-2 gap-y-10 gap-x-6 md:grid-cols-4">
          <Stat n="3.4×" label="faster decisions vs. group chat" />
          <Stat n="78%" label="of plans lock before their deadline" />
          <Stat n="6,200" label="squads converging each weekend" />
          <Stat n="11" label="messages to a yes, on average" />
        </ul>

        <figure className="mt-20 grid gap-8 rounded-3xl bg-paper-card p-8 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_24px_48px_-24px_rgba(20,15,10,0.12)] md:grid-cols-[auto_1fr] md:items-center md:gap-12 md:p-12">
          <div
            aria-hidden
            className="size-20 shrink-0 rounded-full bg-gradient-to-br from-coral-soft to-coral/30 md:size-24"
          />
          <div>
            <blockquote className="font-serif text-2xl font-normal leading-snug text-ink sm:text-3xl">
              “We used to spend 40 minutes arguing about brunch and end up at the place we always go. Now we just{" "}
              <span className="italic text-coral [font-family:var(--font-instrument-serif)]">
                show up there
              </span>{" "}
              without the 40 minutes.”
            </blockquote>
            <figcaption className="mt-4 text-sm text-ink-muted">
              <span className="font-semibold text-ink">Mira K.</span> · Designer · plans things for 6 friends in SF
            </figcaption>
          </div>
        </figure>
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <li className="flex flex-col gap-2">
      <span className="font-serif text-5xl font-normal leading-none tracking-[-0.02em] text-ink md:text-6xl">
        {n}
      </span>
      <span className="text-xs leading-relaxed text-ink-muted md:text-sm">{label}</span>
    </li>
  );
}
