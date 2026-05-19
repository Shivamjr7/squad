import Link from "next/link";

export const metadata = {
  title: "Child safety standards — Squad",
  description:
    "Squad's child safety standards and zero-tolerance policy on child sexual abuse and exploitation (CSAE). Reporting and contact information.",
};

export default function ChildSafetyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl font-normal tracking-[-0.01em] text-ink">
          Child safety standards
        </h1>
        <p className="text-sm text-ink-muted">Last updated: May 19, 2026</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">Our position</h2>
        <p className="text-base leading-relaxed text-ink">
          Squad has a zero-tolerance policy toward child sexual abuse material
          (CSAM) and any form of child sexual abuse and exploitation (CSAE).
          This applies to all content, accounts, and conduct on Squad without
          exception.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">What Squad is</h2>
        <p className="text-base leading-relaxed text-ink">
          Squad is an invite-only group-planning app for friends ages 13 and
          older. It is used to coordinate meet-ups: drop a plan, vote in /
          maybe / out, and lock the answer. It is not a social network, dating
          app, or chat app.
        </p>
        <p className="text-base leading-relaxed text-ink">
          Because of how Squad is built, several common CSAE vectors are
          structurally absent:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-base leading-relaxed text-ink">
          <li>
            <span className="font-medium">No public content.</span> Every plan,
            comment, and vote is scoped to an invite-only circle of friends.
            There is no public feed, no discovery, and no way for strangers to
            see content.
          </li>
          <li>
            <span className="font-medium">No direct messaging.</span> Squad
            does not provide one-to-one chat, video, or voice communication
            between users.
          </li>
          <li>
            <span className="font-medium">No user media uploads.</span> Users
            cannot upload photos, videos, or audio. Profile avatars are
            fetched read-only from the user&apos;s Google account at sign-in.
          </li>
          <li>
            <span className="font-medium">No livestreaming.</span> Squad has
            no real-time broadcasting, ephemeral content, or stories.
          </li>
          <li>
            <span className="font-medium">Invite-only circles.</span> Users
            can only interact with people who have explicitly accepted an
            invite to the same circle.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">Standards we hold</h2>
        <ul className="ml-5 list-disc space-y-1 text-base leading-relaxed text-ink">
          <li>
            We prohibit CSAM and any conduct that sexualises, exploits, or
            endangers minors on Squad.
          </li>
          <li>
            We prohibit using Squad to groom, solicit, or facilitate offline
            harm to minors.
          </li>
          <li>
            We comply with applicable child-safety laws in every jurisdiction
            Squad operates in, including the United States{" "}
            <span className="italic">18 U.S.C. § 2258A</span> reporting
            requirement and India&apos;s POCSO Act and IT Rules.
          </li>
          <li>
            We respond to verified reports promptly: removing offending
            content, terminating accounts, and preserving evidence for law
            enforcement.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">Reporting</h2>
        <p className="text-base leading-relaxed text-ink">
          If you encounter CSAM, suspected CSAE, or any behaviour that puts a
          minor at risk on Squad, email{" "}
          <a
            href="mailto:shivamjr7@gmail.com?subject=Child%20safety%20report"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            shivamjr7@gmail.com
          </a>{" "}
          with the subject line <span className="italic">Child safety report</span>
          . Include the circle name, plan, or username involved and any context
          you can share. We treat these reports as urgent.
        </p>
        <p className="text-base leading-relaxed text-ink">
          You can also report CSAM directly to the relevant authorities:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-base leading-relaxed text-ink">
          <li>
            <span className="font-medium">United States:</span> National Center
            for Missing &amp; Exploited Children (NCMEC) CyberTipline —{" "}
            <a
              href="https://report.cybertip.org"
              className="text-coral-strong underline-offset-2 hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              report.cybertip.org
            </a>
          </li>
          <li>
            <span className="font-medium">India:</span> National Cyber Crime
            Reporting Portal —{" "}
            <a
              href="https://cybercrime.gov.in"
              className="text-coral-strong underline-offset-2 hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              cybercrime.gov.in
            </a>
          </li>
          <li>
            <span className="font-medium">Elsewhere:</span> contact local law
            enforcement or your country&apos;s designated reporting body.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">Enforcement</h2>
        <p className="text-base leading-relaxed text-ink">
          When we receive a verified report or detect a violation, we:
        </p>
        <ol className="ml-5 list-decimal space-y-1 text-base leading-relaxed text-ink">
          <li>Remove the offending content immediately.</li>
          <li>
            Terminate the responsible account and any associated accounts.
          </li>
          <li>
            Preserve account data and content as required by law to support
            investigation by NCMEC, applicable Indian authorities, or other
            law enforcement.
          </li>
          <li>
            Report apparent CSAM to NCMEC as required by U.S. federal law.
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl text-ink">Designated contact</h2>
        <p className="text-base leading-relaxed text-ink">
          For child-safety inquiries from law enforcement, regulators, or
          safety researchers:
        </p>
        <p className="text-base leading-relaxed text-ink">
          Shivam Jari ·{" "}
          <a
            href="mailto:shivamjr7@gmail.com?subject=Child%20safety%20inquiry"
            className="text-coral-strong underline-offset-2 hover:underline"
          >
            shivamjr7@gmail.com
          </a>
        </p>
      </section>

      <p className="text-sm text-ink-muted">
        See also our{" "}
        <Link
          href="/privacy"
          className="text-coral-strong underline-offset-2 hover:underline"
        >
          privacy policy
        </Link>{" "}
        and{" "}
        <Link
          href="/terms"
          className="text-coral-strong underline-offset-2 hover:underline"
        >
          terms
        </Link>
        .
      </p>
    </main>
  );
}
