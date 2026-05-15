"use client";

// S6 — Suggest drawer. Per CLAUDE.md / user direction this lives OUTSIDE the
// create-plan form (entry point on the home page in place of the old quick
// nudge). The drawer surfaces 3–5 ranked Activities from the S5 server
// action; tapping Add closes the drawer and bubbles the venue label + log id
// back up so the host can open the new-plan flow pre-filled.
//
// Spec sources: docs/specs/suggest-plan/02-user-flows.md (Flows G/H/I),
// 05-api-contracts.md (action shapes), 10-edge-cases.md (empty/degraded UX).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getSuggestions,
  recordSuggestionFeedback,
} from "@/lib/actions/suggest-plan";
import { isActionError } from "@/lib/actions/errors";
import { track } from "@/lib/analytics";
import { getBrowserTimeZone } from "@/lib/tz";
import type {
  GetSuggestionsInput,
} from "@/lib/validation/suggest";
import type { RankedResult } from "@/lib/suggest/types";

const DESKTOP_QUERY = "(min-width: 768px)";

// Mirrors the planType enum (PLAN.md §5). Only the four high-signal chips are
// surfaced — "other" widens to every category which is too broad for a quick
// browsing surface.
const PLAN_TYPE_CHIPS: Array<{
  value: GetSuggestionsInput["planType"];
  label: string;
  emoji: string;
}> = [
  { value: "eat", label: "Eat", emoji: "🍽" },
  { value: "chai", label: "Chai", emoji: "☕" },
  { value: "play", label: "Play", emoji: "🎉" },
  { value: "stay-in", label: "Stay in", emoji: "🛋" },
];

// Search-radius tiers. Spec Flow H §3 lists 1/3/5/10; we extend to 25/50
// because users beyond city centers (or weekend short-trip planners) hit
// the "everything nearby" empty state too fast at 10. Server validation
// (validation/suggest.ts) allows up to 100 km; UI tops at 50 because the
// "what should we do tonight" framing breaks beyond that distance.
const DISTANCE_TIERS = [1, 3, 5, 10, 25, 50] as const;

type SuggestDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  circleId: string;
  /** Bubbled when user picks Add. Host opens the new-plan flow pre-filled. */
  onPickVenue: (args: {
    label: string;
    itemId: string;
    suggestionLogId: string;
    planType: GetSuggestionsInput["planType"];
    startsAtLocal: string;
  }) => void;
};

// Picks a sensible default `startsAtLocal` ("tonight 8pm" or "tomorrow 8pm"
// if it's already late). Mirrors new-plan-form's defaultStartsAt heuristic
// so the suggestion window agrees with what the user will see in the form.
function defaultStartsAtLocal(now: Date): string {
  const d = new Date(now);
  if (now.getHours() >= 19) d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function metersToShortDistance(m: number | undefined): string | null {
  if (m === undefined || !Number.isFinite(m)) return null;
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

type GeoCoords = { lat: number; lng: number; accuracyMeters?: number };
type GeoState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "unsupported" }
  | { kind: "ok"; coords: GeoCoords };

// Request device geolocation. Caches off (`maximumAge: 0`) so re-opens get
// fresh coords. Branches the rejection reason so the UI can distinguish
// "blocked at the browser level" from "GPS chip declined to answer".
function requestGeolocation(): Promise<GeoState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ kind: "unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          kind: "ok",
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          },
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          resolve({ kind: "denied" });
          return;
        }
        resolve({ kind: "unavailable" });
      },
      { maximumAge: 0, timeout: 10_000, enableHighAccuracy: false },
    );
  });
}

export function SuggestDrawer({
  open,
  onOpenChange,
  circleId,
  onPickVenue,
}: SuggestDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!mounted) return null;

  const body = (
    <SuggestDrawerBody
      circleId={circleId}
      onPickVenue={onPickVenue}
      onClose={() => onOpenChange(false)}
      open={open}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="grid h-[min(720px,90vh)] max-w-md grid-rows-1 gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Suggest a venue</DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="grid h-[100dvh] grid-rows-1 gap-0 overflow-hidden p-0"
      >
        <SheetTitle className="sr-only">Suggest a venue</SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      results: RankedResult[];
      logId: string;
      degraded: Array<{ provider: string; reason: string }>;
    }
  | {
      kind: "empty";
      reason: "empty" | "providers_down" | "no_centroid";
      logId?: string;
    }
  | { kind: "errored"; message: string };

function SuggestDrawerBody({
  circleId,
  onPickVenue,
  onClose,
  open,
}: {
  circleId: string;
  onPickVenue: SuggestDrawerProps["onPickVenue"];
  onClose: () => void;
  open: boolean;
}) {
  const now = useMemo(() => new Date(), []);
  const tz = useMemo(() => getBrowserTimeZone(), []);
  const startsAtLocal = useMemo(() => defaultStartsAtLocal(now), [now]);

  const [planType, setPlanType] =
    useState<GetSuggestionsInput["planType"]>("eat");
  const [distanceTierIdx, setDistanceTierIdx] = useState(1); // start at 3km
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [geoState, setGeoState] = useState<GeoState>({ kind: "idle" });
  // Suggestions the user has explicitly rejected or already seen via refresh.
  // Both go into the pool because Flow H records ignored sets as soft excludes
  // (telemetry only on the server, hard-suppressed locally to keep UX honest).
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  // Local hide list — keeps reject taps instant without waiting for a refetch.
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [pendingFeedback, setPendingFeedback] = useState<Set<string>>(
    new Set(),
  );

  // Track the latest in-flight fetch so a stale resolve never clobbers a
  // newer state (rapid refresh / plan-type swap).
  const fetchSeq = useRef(0);

  const requestGeoNow = useCallback(() => {
    setGeoState({ kind: "requesting" });
    void requestGeolocation().then(setGeoState);
  }, []);

  // S8 — fire `suggest_open` once per mount. SuggestDrawerBody is unmounted
  // when the host Sheet/Dialog closes (radix default), so each open is a
  // fresh mount and a fresh event. planType reflects the user's last choice
  // before close (or 'eat' default on first open).
  const openTrackedRef = useRef(false);
  useEffect(() => {
    if (!open || openTrackedRef.current) return;
    openTrackedRef.current = true;
    track("suggest_open", { planType });
  }, [open, planType]);

  // Always request fresh geo on each drawer-open. We never reuse a cached
  // reading from a previous session — keeps the "show me what's near where
  // I am right now" promise honest.
  useEffect(() => {
    if (!open) return;
    requestGeoNow();
  }, [open, requestGeoNow]);

  const fetchSuggestions = useCallback(
    async (opts: {
      planType: GetSuggestionsInput["planType"];
      distanceKmCap: number;
      excludeIds: string[];
      geo: GeoCoords;
    }) => {
      const seq = ++fetchSeq.current;
      setStatus({ kind: "loading" });

      try {
        const requestNonce = crypto.randomUUID();
        const result = await getSuggestions({
          circleId,
          planType: opts.planType,
          timeMode: "exact",
          startsAtLocal,
          timeZone: tz,
          isApproximate: false,
          geo: opts.geo,
          distanceKmCap: opts.distanceKmCap,
          excludeIds: opts.excludeIds,
          recipientUserIds: [],
          limit: 5,
          requestNonce,
        });
        if (seq !== fetchSeq.current) return;

        const degraded = result.degraded ?? [];
        if (result.results.length === 0) {
          // 10-edge-cases.md distinguishes provider failure from filter
          // misses. With the geo gate above, no_centroid shouldn't fire
          // anymore — keep the classifier defensive though.
          const nonWeather = degraded.filter(
            (d) => d.reason !== "weather_unavailable",
          );
          const reason: "providers_down" | "empty" =
            nonWeather.length > 0 ? "providers_down" : "empty";
          setStatus({
            kind: "empty",
            reason,
            logId: result.suggestionLogId,
          });
          track("suggest_empty", { reason });
          return;
        }
        setStatus({
          kind: "ready",
          results: result.results,
          logId: result.suggestionLogId,
          degraded,
        });
      } catch (err) {
        if (seq !== fetchSeq.current) return;
        const msg = isActionError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't load suggestions.";
        setStatus({ kind: "errored", message: msg });
      }
    },
    [circleId, startsAtLocal, tz],
  );

  // Fetch when geo is ready and on any planType / distance change. Geo is
  // the gate — until it resolves to "ok", we don't hit the server.
  useEffect(() => {
    if (!open) return;
    if (geoState.kind !== "ok") return;
    fetchSuggestions({
      planType,
      distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
      excludeIds: [],
      geo: geoState.coords,
    });
    setExcludeIds([]);
    setHiddenItemIds(new Set());
  }, [open, geoState, planType, distanceTierIdx, fetchSuggestions]);

  const visibleResults =
    status.kind === "ready"
      ? status.results.filter((r) => !hiddenItemIds.has(r.id))
      : [];

  async function handleReject(item: RankedResult) {
    if (status.kind !== "ready") return;
    const rank = status.results.findIndex((r) => r.id === item.id) + 1;
    track("suggest_reject", { rank, category: item.activity.category });
    setHiddenItemIds((prev) => new Set(prev).add(item.id));
    setExcludeIds((prev) => [...prev, item.activity.id]);
    setPendingFeedback((prev) => new Set(prev).add(item.id));
    try {
      await recordSuggestionFeedback({
        suggestionLogId: status.logId,
        itemId: item.id,
        feedback: "reject",
      });
    } catch {
      // Reject is optimistic; the spec accepts the local hide even if the
      // server write fails. We just silently swallow so a flaky network
      // doesn't surface a toast every time.
    } finally {
      setPendingFeedback((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function handleAdd(item: RankedResult) {
    if (status.kind !== "ready") return;
    const rank = status.results.findIndex((r) => r.id === item.id) + 1;
    track("suggest_add", {
      rank,
      confidence: item.confidence,
      category: item.activity.category,
    });
    setPendingFeedback((prev) => new Set(prev).add(item.id));
    // Record-then-route. We don't block the navigation on the write — Flow G
    // §6 lists Add as optimistic, and we don't want a slow round trip to keep
    // the drawer up after the user has visually committed.
    void recordSuggestionFeedback({
      suggestionLogId: status.logId,
      itemId: item.id,
      feedback: "add",
    }).catch(() => {
      // Silent: the venue still lands in the form. won/cancelled bookkeeping
      // is server-driven (S7) and doesn't depend on this write.
    });
    onPickVenue({
      label: item.activity.name,
      itemId: item.id,
      suggestionLogId: status.logId,
      planType,
      startsAtLocal,
    });
    onClose();
  }

  function handleRefresh() {
    track("suggest_refresh", {
      remainingCount:
        status.kind === "ready" ? visibleResults.length : 0,
    });
    if (geoState.kind !== "ok") {
      // Geo isn't usable — refresh re-requests it instead of pretending to
      // fetch. Browser will silently fail if user previously blocked; the
      // empty state guides them through resetting the permission.
      requestGeoNow();
      return;
    }
    if (status.kind !== "ready") {
      fetchSuggestions({
        planType,
        distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
        excludeIds,
        geo: geoState.coords,
      });
      return;
    }
    // Tag the surfaced set as refresh feedback (telemetry, per Flow H §2).
    // Fire and forget — the new fetch is the user-visible action.
    for (const r of visibleResults) {
      void recordSuggestionFeedback({
        suggestionLogId: status.logId,
        itemId: r.id,
        feedback: "refresh",
      }).catch(() => {});
    }
    const ids = visibleResults.map((r) => r.activity.id);
    const merged = Array.from(new Set([...excludeIds, ...ids])).slice(-50);
    setExcludeIds(merged);
    fetchSuggestions({
      planType,
      distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
      excludeIds: merged,
      geo: geoState.coords,
    });
  }

  function handleWiden() {
    if (distanceTierIdx >= DISTANCE_TIERS.length - 1) {
      toast.info("Already at the widest range.");
      return;
    }
    setDistanceTierIdx((i) => Math.min(DISTANCE_TIERS.length - 1, i + 1));
  }

  // Render priority:
  //   geo not ok → geo empty state (only header + body chrome show)
  //   geo ok + fetch loading → skeleton
  //   geo ok + status ready → results
  //   geo ok + status empty/errored → respective empty
  const showGeoState =
    geoState.kind === "requesting" ||
    geoState.kind === "denied" ||
    geoState.kind === "unavailable" ||
    geoState.kind === "unsupported";

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-paper">
      {/* Header */}
      <header className="border-b border-ink/10 bg-paper px-4 py-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-coral/20 text-coral">
              <Sparkles className="size-3.5" aria-hidden />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink">
              Suggest
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={
                status.kind === "loading" || geoState.kind === "requesting"
              }
              className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted transition hover:bg-paper-card disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              aria-label="Refresh suggestions"
            >
              <RotateCcw className="size-3" aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-full border border-ink/15 text-ink transition hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* Body — scroll container. grid-rows minmax(0,1fr) on the parent
          guarantees this row never expands past the sheet height. */}
      <div className="overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pt-6 pb-10">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-serif text-[28px] leading-[1.1] font-semibold text-ink">
              Where should the squad go?
            </h2>
            <p className="text-sm text-ink-muted">
              A few picks near you for tonight. Pick one — we&apos;ll drop
              it into a new plan.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Plan type"
            className="flex flex-wrap gap-1.5"
          >
            {PLAN_TYPE_CHIPS.map((chip) => {
              const active = planType === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPlanType(chip.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-ink bg-ink text-paper-card"
                      : "border-ink/15 bg-paper-card/40 text-ink hover:bg-paper-card",
                  )}
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div
            role="tablist"
            aria-label="Search radius"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Within
            </span>
            {DISTANCE_TIERS.map((km, idx) => {
              const active = distanceTierIdx === idx;
              return (
                <button
                  key={km}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDistanceTierIdx(idx)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-ink bg-ink text-paper-card"
                      : "border-ink/15 bg-paper-card/40 text-ink hover:bg-paper-card",
                  )}
                >
                  {km} km
                </button>
              );
            })}
          </div>

          {showGeoState ? (
            <GeoEmptyState state={geoState} onRetry={requestGeoNow} />
          ) : null}

          {!showGeoState && status.kind === "loading" ? (
            <LoadingSkeleton />
          ) : null}

          {!showGeoState && status.kind === "errored" ? (
            <EmptyState
              title="Couldn't load suggestions"
              body={status.message}
              ctaLabel="Try again"
              onCta={() => {
                if (geoState.kind !== "ok") return;
                fetchSuggestions({
                  planType,
                  distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
                  excludeIds,
                  geo: geoState.coords,
                });
              }}
            />
          ) : null}

          {!showGeoState && status.kind === "empty" ? (
            status.reason === "providers_down" ? (
              <EmptyState
                title="Suggest isn't reachable right now"
                body="Type a venue manually instead, or try again in a moment."
                ctaLabel="Try again"
                onCta={() => {
                  if (geoState.kind !== "ok") return;
                  fetchSuggestions({
                    planType,
                    distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
                    excludeIds,
                    geo: geoState.coords,
                  });
                }}
              />
            ) : (
              <EmptyState
                title="That's everything nearby"
                body={
                  distanceTierIdx < DISTANCE_TIERS.length - 1
                    ? `Try widening the area to ${DISTANCE_TIERS[distanceTierIdx + 1]} km.`
                    : "Already at the widest range. Try a different plan type."
                }
                ctaLabel={
                  distanceTierIdx < DISTANCE_TIERS.length - 1
                    ? `Widen to ${DISTANCE_TIERS[distanceTierIdx + 1]} km`
                    : "Refresh"
                }
                onCta={
                  distanceTierIdx < DISTANCE_TIERS.length - 1
                    ? handleWiden
                    : handleRefresh
                }
              />
            )
          ) : null}

          {!showGeoState &&
          status.kind === "ready" &&
          visibleResults.length === 0 ? (
            <EmptyState
              title="No more picks here"
              body="Refresh to widen the search."
              ctaLabel="Refresh"
              onCta={handleRefresh}
            />
          ) : null}

          {!showGeoState &&
          status.kind === "ready" &&
          visibleResults.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {visibleResults.map((item) => {
                const dist = metersToShortDistance(item.activity.distanceMeters);
                const isPending = pendingFeedback.has(item.id);
                const isLowConfidence = item.confidence === "low";
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "relative flex flex-col gap-3 rounded-2xl border border-ink/10 bg-paper-card p-4 shadow-sm transition",
                      isPending && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleReject(item)}
                      disabled={isPending}
                      className="absolute right-2 top-2 rounded-full p-1 text-ink-muted transition hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral disabled:opacity-50"
                      aria-label={`Reject ${item.activity.name}`}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                    <div className="flex flex-col gap-1 pr-7">
                      <div className="flex items-center gap-2">
                        <h3 className="font-serif text-lg leading-tight text-ink">
                          {item.activity.name}
                        </h3>
                        {item.activity.priceTier ? (
                          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                            {item.activity.priceTier}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-ink-muted">
                        {item.explanation}
                      </p>
                      {dist || item.activity.address ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted">
                          <MapPin className="size-3" aria-hidden />
                          {[item.activity.address, dist]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      {isLowConfidence ? (
                        <span className="mt-1 inline-flex w-fit rounded-full bg-paper px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                          Low confidence
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAdd(item)}
                      disabled={isPending}
                      className="self-start rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral disabled:opacity-50"
                    >
                      Add to plan
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {!showGeoState &&
          status.kind === "ready" &&
          status.degraded.length > 0 ? (
            <p className="text-[11px] text-ink-muted">
              Some sources weren&apos;t available:{" "}
              {status.degraded.map((d) => d.provider).join(", ")}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Geo-specific empty state. Different copy + CTA per failure mode so the
// user knows whether to grant permission, reset their browser, or move to
// a device with GPS.
function GeoEmptyState({
  state,
  onRetry,
}: {
  state: GeoState;
  onRetry: () => void;
}) {
  if (state.kind === "requesting") {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-5 py-6">
        <p className="font-serif text-lg text-ink">Checking your location…</p>
        <p className="text-xs text-ink-muted">
          Your browser may ask for permission — pick <strong>Allow</strong>{" "}
          to see nearby spots.
        </p>
      </div>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <EmptyState
        title="Location isn't available here"
        body="Suggest needs your device's location to pick nearby spots. Try a browser or device that supports geolocation."
        ctaLabel="Try again"
        onCta={onRetry}
      />
    );
  }

  if (state.kind === "unavailable") {
    return (
      <EmptyState
        title="Couldn't read your location"
        body="Your device declined to share coordinates. Try moving somewhere with better signal, or retry."
        ctaLabel="Try again"
        onCta={onRetry}
      />
    );
  }

  // denied
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-coral/30 bg-coral-soft/40 px-5 py-6">
      <p className="font-serif text-lg text-ink">Allow location to continue</p>
      <p className="text-xs text-ink-muted">
        Suggest only shows places near where you actually are. Click the lock
        icon in your browser&apos;s address bar, set <strong>Location</strong>{" "}
        to <strong>Allow</strong>, then tap Try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        Try again
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-paper-card p-4"
        >
          <div className="h-4 w-1/2 animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-ink/10" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  title,
  body,
  ctaLabel,
  onCta,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-5 py-6">
      <p className="font-serif text-lg text-ink">{title}</p>
      <p className="text-xs text-ink-muted">{body}</p>
      <button
        type="button"
        onClick={onCta}
        className="rounded-full border border-ink/15 bg-paper-card px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        {ctaLabel}
      </button>
    </div>
  );
}
