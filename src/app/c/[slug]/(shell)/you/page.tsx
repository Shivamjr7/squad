import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { EditDisplayName } from "@/components/circle/edit-display-name";
import { DeleteAccountButton } from "@/components/circle/delete-account-button";
import { YouSignOutButton } from "@/components/circle/sign-out-button";
import {
  ManageDevices,
  type ManageDeviceRow,
} from "@/components/circle/manage-devices";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { requireDisplayNameSet } from "@/lib/auth";
import {
  getCachedUserDevices,
  getCachedUserProfile,
} from "@/lib/server-cache";

// /c/[slug]/you renders identical content across every circle the user is in
// — the per-circle CircleSwitcher + bell + theme toggle already live in the
// AppShell top bar (mobile) and Sidebar (desktop), so the page itself is
// stripped to the user-scoped surfaces only.
//
// Both server reads (`users` profile, `push_subscriptions` for Manage devices)
// route through `unstable_cache` keyed on userId. The Squad page owns
// per-circle membership context (leave-circle CTA, role badge); /you stays
// circle-agnostic so switching circles never refetches the same identical
// rows.
export default async function YouPage() {
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

  const [me, pushRows] = await Promise.all([
    getCachedUserProfile(userId),
    getCachedUserDevices(userId),
  ]);
  if (!me) notFound();

  const devices: ManageDeviceRow[] = pushRows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    deviceHint:
      r.deviceHint === "mobile" || r.deviceHint === "desktop"
        ? r.deviceHint
        : null,
    // Already ISO strings — `getCachedUserDevices` pre-serializes dates
    // before they pass through unstable_cache's JSON boundary.
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt,
  }));

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      {/* Desktop-only top row — mirrors Home/Squad. Mobile chrome (brand,
          circle switcher, bell, theme) is in the AppShell, so this page
          renders no header on small screens. */}
      <div className="hidden items-center justify-end gap-1 px-6 pt-3 md:flex">
        <UserButton />
      </div>

      <div className="px-4 pt-6 sm:px-6">
        <div className="space-y-6">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-ink-muted">You</span>
            <h1 className="font-serif text-[32px] leading-[1.1] font-semibold text-ink sm:text-[36px]">
              {me.displayName}
            </h1>
            <p className="truncate text-sm text-ink-muted">{me.email}</p>
          </div>

          {/* Two-column on ≥md: Profile on the left, Preferences + Devices
              on the right. Account section spans the full width below. */}
          <div className="grid grid-cols-1 gap-8 px-0 sm:px-0 md:grid-cols-2 md:gap-x-10">
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow text-ink-muted">Profile</h2>
              <EditDisplayName initialName={me.displayName} />
              <div className="flex flex-col gap-1 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
                <span className="text-xs uppercase tracking-wide text-ink-muted">
                  Email
                </span>
                <span className="truncate text-sm text-ink">{me.email}</span>
              </div>
            </section>

            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h2 className="eyebrow text-ink-muted">Preferences</h2>
                <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
                  <span className="text-xs uppercase tracking-wide text-ink-muted">
                    Theme
                  </span>
                  <ThemeToggle variant="segment" />
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="eyebrow text-ink-muted">Manage devices</h2>
                <p className="text-xs text-ink-muted">
                  Squad pings you when a new plan drops, when one&apos;s about
                  to lock, and 45 minutes before you should leave. One row per
                  device you&apos;ve enabled.
                </p>
                <ManageDevices devices={devices} />
              </section>
            </div>

            <section className="flex flex-col gap-3 md:col-span-2 md:border-t md:border-ink-hairline md:pt-6">
              <h2 className="eyebrow text-ink-muted">Account</h2>
              <div className="flex flex-col gap-3 md:max-w-md">
                <YouSignOutButton />
                <DeleteAccountButton />
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
