import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
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

export const metadata: Metadata = {
  title: "Squad",
  description: "Plan a thing. Vote. Show up.",
};

// viewportFit:cover unlocks env(safe-area-inset-*) on iOS — without it the
// FAB and comment composer's safe-area padding both collapse to 0 and sit
// behind the home indicator. colorScheme pins light mode (next-themes is
// installed but unwired); revisit if real dark-mode lands in v2.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#F5F0EA",
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
        className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col" suppressHydrationWarning>
          <ViewTransition>{children}</ViewTransition>
          <Toaster richColors closeButton />
        </body>
      </html>
    </ClerkProvider>
  );
}
