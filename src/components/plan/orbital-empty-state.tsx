// Pure-CSS orbital "?" empty state. Three concentric rings, each with a
// single dot orbiting at a staggered duration. The orbit is implemented as
// a wrapper rotated infinitely (transform-origin: center), with the dot
// pinned to the wrapper's edge. Respects prefers-reduced-motion.

export function OrbitalEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-7 px-6 py-10 text-center">
      <Orbit />
      <div className="flex flex-col gap-3">
        <h2 className="font-serif text-3xl font-semibold italic text-ink">
          No plan yet.
        </h2>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-ink-muted">
          Quiet weekend. Drop an &lsquo;anyone free?&rsquo; and the squad has
          2h to converge.
        </p>
      </div>
      <div>{children}</div>
    </div>
  );
}

const ORBIT_STYLE = `
  @keyframes orbit-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .orbit-spinner { animation: none !important; }
  }
`;

function Orbit() {
  return (
    <div
      aria-hidden
      className="relative flex size-56 items-center justify-center"
    >
      <style>{ORBIT_STYLE}</style>

      {/* Three rings */}
      <Ring size={56} />
      <Ring size={36} />
      <Ring size={20} />

      {/* Three orbiting dots — staggered durations */}
      <Dot size={56} duration="14s" delay="0s" />
      <Dot size={36} duration="9s" delay="-3s" />
      <Dot size={20} duration="5s" delay="-1.5s" />

      {/* Center "?" */}
      <span className="relative z-10 font-serif text-[64px] font-semibold leading-none italic text-coral">
        ?
      </span>
    </div>
  );
}

function Ring({ size }: { size: number }) {
  // size in % of container — the ring radius. Rendered as a circle stroke.
  return (
    <span
      className="absolute rounded-full border border-dashed border-ink/15"
      style={{
        width: `${size * 4}px`,
        height: `${size * 4}px`,
      }}
    />
  );
}

function Dot({
  size,
  duration,
  delay,
}: {
  size: number;
  duration: string;
  delay: string;
}) {
  // Wrapper is the same diameter as its ring; the dot is positioned at the
  // top of the wrapper's bounds. Rotating the wrapper carries the dot in a
  // circle.
  return (
    <span
      className="orbit-spinner absolute"
      style={{
        width: `${size * 4}px`,
        height: `${size * 4}px`,
        animation: `orbit-spin ${duration} linear infinite`,
        animationDelay: delay,
      }}
    >
      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
        <span className="block size-2 rounded-full bg-coral" />
      </span>
    </span>
  );
}
