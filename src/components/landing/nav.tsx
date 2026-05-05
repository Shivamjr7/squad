import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/8 bg-paper/85 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span aria-hidden className="inline-block size-2 rounded-full bg-coral" />
          Squad
        </Link>
        <div className="hidden items-center gap-7 text-sm text-ink-muted md:flex">
          <a href="#how-it-works" className="hover:text-ink">How it works</a>
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#why" className="hover:text-ink">Why</a>
          <SignInButton mode="modal">
            <button className="hover:text-ink">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper hover:bg-ink/90">
              Get the app
            </button>
          </SignUpButton>
        </div>
        <div className="flex items-center gap-3 text-sm md:hidden">
          <SignInButton mode="modal">
            <button className="text-ink-muted">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-paper">
              Get
            </button>
          </SignUpButton>
        </div>
      </nav>
    </header>
  );
}
