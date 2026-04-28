export default function NotificationsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Email preferences</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Coming soon. For now, email{" "}
        <a
          href="mailto:squad@example.com"
          className="font-medium underline underline-offset-2"
        >
          squad@example.com
        </a>{" "}
        to unsubscribe entirely.
      </p>
    </main>
  );
}
