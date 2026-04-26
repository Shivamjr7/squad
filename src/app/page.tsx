import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const user = await currentUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Squad</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        Plan a thing. Vote. Show up. (M1: auth hello-world.)
      </p>

      <Show when="signed-out">
        <div className="flex gap-3">
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button variant="outline">Sign up</Button>
          </SignUpButton>
        </div>
      </Show>

      <Show when="signed-in">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm">
            Hello, <span className="font-medium">{user?.firstName ?? "friend"}</span>.
          </p>
          <UserButton />
        </div>
      </Show>
    </main>
  );
}
