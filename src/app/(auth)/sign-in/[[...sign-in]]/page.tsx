import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import { SquadLogo } from "@/components/brand/squad-logo";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const { redirect_url } = await searchParams;
  const { userId } = await auth();
  if (userId) redirect(redirect_url ?? "/");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-6 pb-12 pt-10 text-center">
      <SquadLogo className="size-12 text-ink" title="Squad" />
      <div className="flex flex-col gap-3">
        <h1 className="font-instrument-serif text-[44px] leading-[1.05] italic text-ink sm:text-[52px]">
          are we still on?
        </h1>
        <p className="text-sm leading-relaxed text-ink-muted sm:text-base">
          Sign in to join your squad.
        </p>
      </div>
      <SignIn
        fallbackRedirectUrl={redirect_url ?? "/"}
        appearance={{
          variables: {
            colorPrimary: "oklch(0.64 0.22 28)",
            colorText: "oklch(0.14 0.02 50)",
            colorTextSecondary: "oklch(0.48 0.02 50)",
            colorBackground: "#F5F0EA",
            colorInputBackground: "oklch(0.99 0.005 80)",
            borderRadius: "0.75rem",
          },
          elements: {
            rootBox: "w-full",
            card: "shadow-none bg-transparent border-0 p-0 w-full",
            header: "hidden",
            socialButtonsBlockButton:
              "bg-ink text-paper border-0 rounded-xl py-3 hover:bg-ink/90 transition-colors",
            socialButtonsBlockButtonText: "font-medium",
            dividerLine: "bg-ink-subtle",
            dividerText: "text-ink-muted text-xs uppercase tracking-wider",
            formFieldLabel: "text-ink-muted text-sm",
            formFieldInput:
              "bg-paper-card border-ink-subtle rounded-xl py-2.5",
            formButtonPrimary:
              "bg-coral text-paper hover:bg-coral-strong rounded-xl py-3 font-medium normal-case",
            footer: "hidden",
            footerActionLink: "text-coral hover:text-coral-strong",
          },
        }}
      />
      <p className="text-xs text-ink-muted">
        Free for groups up to 8 · Invite-only
      </p>
    </main>
  );
}
