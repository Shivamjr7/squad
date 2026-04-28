import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">That page doesn&apos;t exist.</h1>
      <p className="text-sm text-muted-foreground">
        It might have been moved, or never existed in the first place.
      </p>
      <Button asChild>
        <Link href="/">Back to Squad →</Link>
      </Button>
    </main>
  );
}
