import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { SquadLogo } from "@/components/brand/squad-logo";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-subtle bg-paper/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          aria-label="Squad — home"
          className="flex items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
        >
          <SquadLogo className="size-5 text-coral" />
          SQUAD
        </Link>
        <div className="hidden items-center gap-7 text-sm text-ink-muted md:flex">
          <a href="#how-it-works" className="hover:text-ink">How it works</a>
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#why" className="hover:text-ink">Why</a>
          <SignInButton>
            <button className="hover:text-ink">Sign in</button>
          </SignInButton>
          <SignUpButton>
            <button className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper hover:bg-ink/90">
              Get the app
            </button>
          </SignUpButton>
        </div>
        <div className="flex items-center gap-3 text-sm md:hidden">
          <SignInButton>
            <button className="text-ink-muted">Sign in</button>
          </SignInButton>
          <SignUpButton>
            <button className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-paper">
              Get
            </button>
          </SignUpButton>
        </div>
      </nav>
    </header>
  );
}
