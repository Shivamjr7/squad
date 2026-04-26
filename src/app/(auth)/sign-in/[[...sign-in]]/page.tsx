import { SignIn } from "@clerk/nextjs";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const { redirect_url } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn fallbackRedirectUrl={redirect_url ?? "/"} />
    </main>
  );
}
