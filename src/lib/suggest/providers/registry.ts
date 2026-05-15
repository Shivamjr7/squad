// Suggest Plan — provider registry. See docs/specs/suggest-plan/08-provider-architecture.md.
//
// Module-level singleton. S3+ provider impls call registerProvider() at boot;
// the pipeline (S4+) calls getProvider() to resolve a category. A missing
// provider is NOT an error — the pipeline records it in `degraded[]` with
// reason `no_provider` and continues.

import type {
  ActivityCategory,
  SuggestionProvider,
} from "@/lib/suggest/types";

const providers = new Map<ActivityCategory, SuggestionProvider>();

/**
 * Register a provider for every category it declares. First registration
 * wins per category — v1 ships one provider per category by convention, and
 * silently dropping later registrations keeps boot deterministic regardless
 * of import order.
 */
export function registerProvider(provider: SuggestionProvider): void {
  for (const category of provider.categories) {
    if (!providers.has(category)) {
      providers.set(category, provider);
    }
  }
}

/**
 * Resolve the provider for a category. Returns undefined if none is
 * registered; the pipeline treats that as `degraded[].reason = 'no_provider'`.
 */
export function getProvider(
  category: ActivityCategory,
): SuggestionProvider | undefined {
  return providers.get(category);
}

/**
 * Test-only override. Replaces any existing provider for the category.
 * Throws outside NODE_ENV=test so accidental production calls are loud.
 */
export function setProvider(
  category: ActivityCategory,
  provider: SuggestionProvider,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setProvider() is test-only.");
  }
  providers.set(category, provider);
}
