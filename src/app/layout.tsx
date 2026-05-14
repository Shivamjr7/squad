import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { PerformanceDashboard } from "@/components/optimized/performance-dashboard";
// @ts-expect-error -- unstable_ViewTransition is provided by the experimental React channel that Next swaps in when experimental.viewTransition is enabled
import { unstable_ViewTransition as ViewTransition } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Squad — stop scrolling, start showing up",
  description:
    "A small group converges on a yes/no/maybe in a short window. WhatsApp loses decisions in scrollback — Squad keeps the current state of a plan as the source of truth.",
  manifest: "/manifest.webmanifest",
  applicationName: "Squad",
  appleWebApp: {
    capable: true,
    title: "Squad",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// viewportFit:cover unlocks env(safe-area-inset-*) on iOS — without it the
// FAB and comment composer's safe-area padding both collapse to 0 and sit
// behind the home indicator. colorScheme = "light dark" tells the browser
// both schemes are supported; next-themes' inline script sets the actual
// data-theme attribute before paint so there's no FOUC. themeColor pair
// covers both schemes for the iOS status bar / Android URL bar tint.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8EFDF" },
    { media: "(prefers-color-scheme: dark)", color: "#15151C" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        // suppressHydrationWarning is required by next-themes: the inline
        // script may flip the data-theme attribute before React hydrates,
        // and React would otherwise warn about the mismatch.
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${instrumentSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col" suppressHydrationWarning>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ViewTransition>{children}</ViewTransition>
            <Toaster richColors closeButton />
            <ServiceWorkerRegister />
            <PerformanceDashboard />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
