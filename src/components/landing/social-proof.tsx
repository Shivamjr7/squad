export function LandingSocialProof() {
  const logos = ["Stripe", "Figma", "Linear", "Vercel", "Notion", "PostHog"];
  return (
    <section className="border-b border-ink/8 py-10 md:py-14">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          As planned by squads at
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-base font-semibold text-ink/55 sm:gap-x-12 sm:text-lg">
          {logos.map((l) => (
            <li
              key={l}
              className="tracking-tight"
              style={{
                fontFamily: l === "FIGMA" || l === "VERCEL" || l === "POSTHOG" ? "var(--font-geist-mono)" : undefined,
              }}
            >
              {l}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
