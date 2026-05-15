// Vercel Web Analytics — tiny no-dep wrapper. Call `track()` from any
// client component. In production (Vercel deploys with Web Analytics
// enabled in project settings) Vercel injects `window.va`; locally and
// during SSR the call is a silent no-op so dev never has to install the
// `@vercel/analytics` package.
//
// Spec: docs/specs/suggest-plan/11-observability.md §Analytics signals —
// events are aggregate / anonymous; never include a user id.

type Primitive = string | number | boolean | null | undefined;

type EventProps = Record<string, Primitive>;

type VaQueue = Array<unknown>;
type VaFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    va?: VaFn | VaQueue;
  }
}

export function track(eventName: string, props?: EventProps): void {
  if (typeof window === "undefined") return;
  const va = window.va;
  if (!va) return;
  try {
    if (typeof va === "function") {
      va("event", { name: eventName, ...(props ?? {}) });
    } else if (Array.isArray(va)) {
      // Pre-init queue (`window.va = window.va || []`). Push and let the
      // injected script flush when it loads.
      va.push(["event", { name: eventName, ...(props ?? {}) }]);
    }
  } catch {
    // Analytics MUST never break a UI flow. Swallow.
  }
}
