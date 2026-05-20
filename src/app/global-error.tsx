"use client";

import { useEffect } from "react";

// Surfaces the underlying client error to the user instead of Next.js's
// generic "Application error: a client-side exception has occurred"
// message. Lets us diagnose prod-only bugs from a screenshot of the page.
//
// Next.js places `global-error.tsx` outside of the root layout, so it has
// to render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort log so the error also shows up in browser DevTools if
    // it's open. The on-screen panel below is the primary surface.
    console.error("[squad-global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          margin: 0,
          padding: "32px 20px",
          background: "#F8EFDF",
          color: "#15151C",
          minHeight: "100vh",
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something broke.</h1>
        <p style={{ fontSize: 13, marginBottom: 16, opacity: 0.7 }}>
          Send this screen to support so we can fix it.
        </p>

        <div
          style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 12,
            padding: 16,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowX: "auto",
          }}
        >
          <div>
            <strong>name:</strong> {error.name}
          </div>
          <div>
            <strong>message:</strong> {error.message}
          </div>
          {error.digest ? (
            <div>
              <strong>digest:</strong> {error.digest}
            </div>
          ) : null}
          {error.stack ? (
            <>
              <div style={{ marginTop: 8 }}>
                <strong>stack:</strong>
              </div>
              <pre style={{ margin: 0 }}>{error.stack}</pre>
            </>
          ) : null}
        </div>

        <button
          onClick={() => reset()}
          style={{
            marginTop: 20,
            padding: "10px 16px",
            borderRadius: 999,
            border: "none",
            background: "#15151C",
            color: "#F8EFDF",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
