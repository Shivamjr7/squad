import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="bg-paper py-14 md:py-20">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10">
        <div className="flex flex-col gap-3">
          <p className="font-serif text-xl font-semibold text-ink">Squad</p>
          <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
            A small app for the small group of people you actually want to see this weekend.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { label: "Features", href: "#features" },
            { label: "Download", href: "#" },
            { label: "Changelog", href: "#" },
            { label: "Roadmap", href: "#" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: "Story", href: "#" },
            { label: "Press kit", href: "#" },
            { label: "Careers", href: "#" },
            { label: "Contact", href: "mailto:hi@squad.app" },
          ]}
        />
        <FooterCol
          title="Squad up"
          links={[
            { label: "Twitter", href: "https://twitter.com" },
            { label: "Instagram", href: "https://instagram.com" },
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
          ]}
        />
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl items-center justify-between border-t border-ink/8 px-5 pt-6 text-[11px] text-ink-muted">
        <span>© {new Date().getFullYear()} Squad</span>
        <span>v1.4.2 — last updated yesterday</span>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        {title}
      </p>
      <ul className="flex flex-col gap-2 text-sm text-ink">
        {links.map((l) => (
          <li key={l.label}>
            {l.href.startsWith("/") ? (
              <Link href={l.href} className="hover:text-coral">
                {l.label}
              </Link>
            ) : (
              <a href={l.href} className="hover:text-coral">
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
