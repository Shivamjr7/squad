"use client";

// Thin client-side re-export of next-themes' provider. Server Components
// can't render the provider directly (it uses React Context), so this
// wrapper crosses the server/client boundary in one place.
export { ThemeProvider } from "next-themes";
