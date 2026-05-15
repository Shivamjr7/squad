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
  Home,
  MapPin,
  Navigation,
  RotateCcw,
  Search,
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
import {
  getCachedSuggestions,
  invalidateSuggestions,
  makeCacheKey,
  setCachedSuggestions,
} from "@/lib/suggest/client-cache";
import {
  geocodeLocation,
  getCircleHome,
  type CircleHome,
  type GeocodeResult,
} from "@/lib/actions/suggest-location";

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

// Three-mode anchor for the suggestion search. "here" defers to device
// geolocation (the existing path); "home" uses circles.home_lat/lng if
// the admin has set it; "custom" geocodes a free-text query via the
// Places searchText endpoint (server action keeps the key secret).
type LocationMode = "here" | "home" | "custom";
type CustomLocation = {
  label: string;
  address?: string;
  coords: GeoCoords;
};

// Single getCurrentPosition call wrapped in a promise. Splits success vs.
// the three failure modes (PERMISSION_DENIED, POSITION_UNAVAILABLE,
// TIMEOUT) so the caller can decide whether to fall back to a different
// strategy or surface a terminal error.
function getPosition(
  opts: PositionOptions,
): Promise<GeoState | { kind: "transient" }> {
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
        // POSITION_UNAVAILABLE (2) or TIMEOUT (3). Treat both as transient
        // so the caller can retry with different options before giving up.
        resolve({ kind: "transient" });
      },
      opts,
    );
  });
}

// Request device geolocation with a two-pass strategy tuned for mobile:
//
//   Pass 1 (fast):  network-based, short timeout, accept a < 1 min cached
//                   fix. This is what works in 95% of cases and avoids the
//                   slow GPS-first-fix path on phones.
//   Pass 2 (slow):  high accuracy, longer timeout, no cache. Fallback for
//                   devices that lack a recent network-positioning result.
//
// The previous single-pass call used `enableHighAccuracy: false` +
// `maximumAge: 0` + a 10s timeout, which on mobile would time out indoors
// (no GPS line-of-sight) and return POSITION_UNAVAILABLE even with
// permission granted — the "even though location is on, it doesn't
// detect" symptom.
//
// We also consult the Permissions API first; if `denied`, getCurrentPosition
// will silently reject without re-prompting, so we short-circuit to the
// recovery UI.
async function requestGeolocation(): Promise<GeoState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { kind: "unsupported" };
  }

  try {
    if (typeof navigator.permissions?.query === "function") {
      const status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      if (status.state === "denied") {
        return { kind: "denied" };
      }
    }
  } catch {
    // Permissions API missing or rejected the name — proceed to direct call.
  }

  // Pass 1 — fast network-positioning, willing to take a recently cached fix.
  const fast = await getPosition({
    maximumAge: 60_000,
    timeout: 8_000,
    enableHighAccuracy: false,
  });
  if (fast.kind === "ok" || fast.kind === "denied") return fast;

  // Pass 2 — high accuracy with a generous timeout. Some Android devices
  // need this to engage the GPS chip; iOS Safari sometimes needs it to
  // hand back any answer at all when the network fix path stalls.
  const slow = await getPosition({
    maximumAge: 0,
    timeout: 20_000,
    enableHighAccuracy: true,
  });
  if (slow.kind === "ok" || slow.kind === "denied") return slow;

  // Both passes failed without a permission denial — usually means system
  // Location Services is off, the device is indoors without a cached fix,
  // or the browser/PWA wrapper isn't surfacing system permission.
  return { kind: "unavailable" };
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
  // Start at 5km — 3km was too tight in low-density areas and was the
  // primary cause of "famous places never show up." Users can still narrow
  // via the radius chips above the result list.
  const [distanceTierIdx, setDistanceTierIdx] = useState(2);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [geoState, setGeoState] = useState<GeoState>({ kind: "idle" });

  // Pass 2 — location-mode state. Default to "here" so the first-time UX
  // matches the previous behavior. Switching mode invalidates the client
  // cache implicitly because the cache key includes the geo bucket, and
  // each mode produces different coords.
  const [locationMode, setLocationMode] = useState<LocationMode>("here");
  const [circleHome, setCircleHome] = useState<CircleHome>(null);
  const [homeLoadedFor, setHomeLoadedFor] = useState<string | null>(null);
  const [customLocation, setCustomLocation] = useState<CustomLocation | null>(
    null,
  );
  const [customQuery, setCustomQuery] = useState("");
  const [customStatus, setCustomStatus] = useState<
    { kind: "idle" } | { kind: "searching" } | { kind: "errored"; message: string }
  >({ kind: "idle" });
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

  // Lazy-load circle home once per drawer mount. We don't need this until
  // the user picks the Home chip, but a single quiet DB read is cheaper
  // than waiting on the first chip tap to show the spinner. Cached per
  // circleId so a reopen on the same circle doesn't refetch.
  useEffect(() => {
    if (!open) return;
    if (homeLoadedFor === circleId) return;
    let cancelled = false;
    void getCircleHome({ circleId })
      .then((result) => {
        if (cancelled) return;
        setCircleHome(result);
        setHomeLoadedFor(circleId);
      })
      .catch(() => {
        // Silent — Home chip just stays hidden.
        if (!cancelled) setHomeLoadedFor(circleId);
      });
    return () => {
      cancelled = true;
    };
  }, [open, circleId, homeLoadedFor]);

  // Submit handler for the custom-location text input. Geocodes the
  // query via the server action (which uses the same Places key,
  // server-side only) and stores the resolved coords + label.
  const handleCustomSearch = useCallback(async () => {
    const trimmed = customQuery.trim();
    if (trimmed.length < 2) {
      setCustomStatus({ kind: "errored", message: "Type at least 2 characters." });
      return;
    }
    setCustomStatus({ kind: "searching" });
    try {
      const result: GeocodeResult = await geocodeLocation({
        circleId,
        query: trimmed,
      });
      setCustomLocation({
        label: result.label,
        address: result.address,
        coords: { lat: result.lat, lng: result.lng },
      });
      setCustomStatus({ kind: "idle" });
    } catch (err) {
      const message = isActionError(err)
        ? err.message
        : err instanceof Error
          ? err.message
          : "Couldn't find that location.";
      setCustomStatus({ kind: "errored", message });
    }
  }, [circleId, customQuery]);

  /**
   * Resolve the effective anchor coords + a UI label for the current
   * locationMode. Returns null when the mode isn't usable yet (geo not
   * resolved / home missing / custom not searched). The fetch effect
   * gates on this returning non-null.
   */
  const resolvedAnchor = useMemo<{
    coords: GeoCoords;
    label: string | null;
  } | null>(() => {
    if (locationMode === "here") {
      if (geoState.kind !== "ok") return null;
      return { coords: geoState.coords, label: null };
    }
    if (locationMode === "home") {
      if (!circleHome) return null;
      return {
        coords: { lat: circleHome.lat, lng: circleHome.lng },
        label: circleHome.label,
      };
    }
    // custom
    if (!customLocation) return null;
    return {
      coords: customLocation.coords,
      label: customLocation.label,
    };
  }, [locationMode, geoState, circleHome, customLocation]);

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

  // Always request fresh geo on each drawer-open (only when the user is
  // in "here" mode — no point asking for GPS if they're searching by
  // home or a custom location). Re-requests on mode-switch back to here.
  useEffect(() => {
    if (!open) return;
    if (locationMode !== "here") return;
    requestGeoNow();
  }, [open, locationMode, requestGeoNow]);

  const fetchSuggestions = useCallback(
    async (opts: {
      planType: GetSuggestionsInput["planType"];
      distanceKmCap: number;
      excludeIds: string[];
      geo: GeoCoords;
      /** When true, bypass the client cache and refetch. Refresh-tap path. */
      forceFresh?: boolean;
    }) => {
      const seq = ++fetchSeq.current;

      // Client cache (5-min TTL) — only consult when excludeIds is empty,
      // because a non-empty excludeIds means the user has rejected items
      // or hit refresh, which already represents a "give me different
      // results" intent. Keying on excludeIds would make the cache useless
      // (every reject mints a new key); ignoring it means rejects continue
      // to hide locally without re-fetching, which matches the existing UX.
      const cacheKey = makeCacheKey({
        circleId,
        planType: opts.planType,
        distanceKmCap: opts.distanceKmCap,
        startsAtLocal,
        timeZone: tz,
        geo: { lat: opts.geo.lat, lng: opts.geo.lng },
      });
      const canUseCache = !opts.forceFresh && opts.excludeIds.length === 0;
      if (canUseCache) {
        const cached = getCachedSuggestions(cacheKey);
        if (cached) {
          const degraded = cached.degraded ?? [];
          if (cached.results.length === 0) {
            const nonWeather = degraded.filter(
              (d) => d.reason !== "weather_unavailable",
            );
            const reason: "providers_down" | "empty" =
              nonWeather.length > 0 ? "providers_down" : "empty";
            setStatus({
              kind: "empty",
              reason,
              logId: cached.suggestionLogId,
            });
            return;
          }
          setStatus({
            kind: "ready",
            results: cached.results,
            logId: cached.suggestionLogId,
            degraded,
          });
          return;
        }
      }

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
          // 8 keeps the drawer scrollable on mobile without feeling thin;
          // ranker's diversity cap (ceil(limit/2)=4 per category) means
          // chai/eat plans show up to 4 cafes, not 3 like before.
          limit: 8,
          requestNonce,
        });
        if (seq !== fetchSeq.current) return;

        // Only cache the "fresh, no rejects" path. Refresh / reject-driven
        // refetches are intentionally narrowed by excludeIds and shouldn't
        // poison the baseline cache.
        if (opts.excludeIds.length === 0) {
          setCachedSuggestions(cacheKey, result);
        }

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

  // Fetch when the resolved anchor is ready, and on any planType / distance
  // / location-mode change. The anchor gate replaces the previous geo-only
  // gate so home / custom modes don't have to wait on GPS.
  useEffect(() => {
    if (!open) return;
    if (!resolvedAnchor) return;
    fetchSuggestions({
      planType,
      distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
      excludeIds: [],
      geo: resolvedAnchor.coords,
    });
    setExcludeIds([]);
    setHiddenItemIds(new Set());
  }, [open, resolvedAnchor, planType, distanceTierIdx, fetchSuggestions]);

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
    if (!resolvedAnchor) {
      // Anchor isn't usable — re-request geo if we're in here-mode; for
      // home/custom there's nothing to retry from the refresh button.
      if (locationMode === "here") requestGeoNow();
      return;
    }
    const anchorCoords = resolvedAnchor.coords;

    // Refresh always bypasses the client cache (user-intent: "give me
    // something different"). Drop the baseline cache entry so the next
    // open-with-same-inputs also starts fresh.
    const key = makeCacheKey({
      circleId,
      planType,
      distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
      startsAtLocal,
      timeZone: tz,
      geo: { lat: anchorCoords.lat, lng: anchorCoords.lng },
    });
    invalidateSuggestions(key);

    if (status.kind !== "ready") {
      fetchSuggestions({
        planType,
        distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
        excludeIds,
        geo: anchorCoords,
        forceFresh: true,
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
      geo: anchorCoords,
      forceFresh: true,
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
  //   here-mode + geo not ok → geo empty state (only header + body chrome)
  //   anchor ready + fetch loading → skeleton
  //   anchor ready + status ready → results
  //   anchor ready + status empty/errored → respective empty
  //   home-mode without home / custom-mode without query → mode prompt
  const showGeoState =
    locationMode === "here" &&
    (geoState.kind === "requesting" ||
      geoState.kind === "denied" ||
      geoState.kind === "unavailable" ||
      geoState.kind === "unsupported");
  const showModePrompt =
    !resolvedAnchor && !showGeoState && locationMode !== "here";

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

          <LocationModeRow
            mode={locationMode}
            onChangeMode={setLocationMode}
            home={circleHome}
            custom={customLocation}
            customQuery={customQuery}
            onChangeCustomQuery={setCustomQuery}
            customStatus={customStatus}
            onSubmitCustom={handleCustomSearch}
            onClearCustom={() => {
              setCustomLocation(null);
              setCustomQuery("");
              setCustomStatus({ kind: "idle" });
            }}
          />

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
            <GeoEmptyState
              state={geoState}
              onRetry={requestGeoNow}
              onPickCustom={() => setLocationMode("custom")}
            />
          ) : null}

          {showModePrompt ? (
            <ModePromptEmptyState
              mode={locationMode}
              hasHome={circleHome !== null}
            />
          ) : null}

          {!showGeoState && !showModePrompt && status.kind === "loading" ? (
            <LoadingSkeleton />
          ) : null}

          {!showGeoState && !showModePrompt && status.kind === "errored" ? (
            <EmptyState
              title="Couldn't load suggestions"
              body={status.message}
              ctaLabel="Try again"
              onCta={() => {
                if (!resolvedAnchor) return;
                fetchSuggestions({
                  planType,
                  distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
                  excludeIds,
                  geo: resolvedAnchor.coords,
                });
              }}
            />
          ) : null}

          {!showGeoState && !showModePrompt && status.kind === "empty" ? (
            status.reason === "providers_down" ? (
              <EmptyState
                title="Suggest isn't reachable right now"
                body="Type a venue manually instead, or try again in a moment."
                ctaLabel="Try again"
                onCta={() => {
                  if (!resolvedAnchor) return;
                  fetchSuggestions({
                    planType,
                    distanceKmCap: DISTANCE_TIERS[distanceTierIdx],
                    excludeIds,
                    geo: resolvedAnchor.coords,
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
          !showModePrompt &&
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
          !showModePrompt &&
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
          !showModePrompt &&
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

// Best-effort UA sniff used only to render platform-specific permission
// instructions. Always treats the "false" case as Android/desktop copy,
// which is the safe default.
function isIOSLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS Safari ≥ 13 sends a Mac UA but still has touch — sniff that.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

// Geo-specific empty state. Different copy + CTA per failure mode so the
// user knows whether to grant permission, reset their browser, or move to
// a device with GPS. The "denied" case offers a one-tap escape hatch into
// custom-location mode so users with a wedged browser permission aren't
// stuck.
function GeoEmptyState({
  state,
  onRetry,
  onPickCustom,
}: {
  state: GeoState;
  onRetry: () => void;
  onPickCustom: () => void;
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
        ctaLabel="Pick an area instead"
        onCta={onPickCustom}
      />
    );
  }

  if (state.kind === "unavailable") {
    // Browser said we have permission but couldn't get coords. On mobile,
    // this is usually one of: (a) system Location Services is off for the
    // browser app, (b) Squad is installed as a PWA and the PWA doesn't have
    // its own location permission yet, or (c) device is indoors with no
    // cached fix and GPS couldn't engage. Spell out the first two since
    // they're the recoverable cases the user can actually fix.
    const ios = isIOSLike();
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-5 py-6">
        <p className="font-serif text-lg text-ink">
          Couldn&apos;t read your location
        </p>
        <p className="text-xs text-ink-muted">
          Permission looks granted but no coordinates came back. Most common
          causes on phones:
        </p>
        <ul className="list-disc pl-4 text-xs text-ink-muted">
          {ios ? (
            <>
              <li>
                System location is off for this app:{" "}
                <strong>
                  Settings → Privacy &amp; Security → Location Services
                </strong>{" "}
                → set Safari (or the installed Squad app) to{" "}
                <strong>While Using</strong>.
              </li>
              <li>
                If Squad is installed to your home screen, it has its own
                permission separate from Safari — check{" "}
                <strong>Settings → Squad → Location</strong>.
              </li>
            </>
          ) : (
            <>
              <li>
                System location is off for Chrome:{" "}
                <strong>Settings → Apps → Chrome → Permissions →
                Location</strong>.
              </li>
              <li>
                If Squad is installed as an app, it has its own location
                permission: <strong>Settings → Apps → Squad → Permissions</strong>.
              </li>
              <li>
                Move closer to a window, or wait a few seconds and tap retry —
                indoor GPS can take a moment.
              </li>
            </>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPickCustom}
            className="rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            Pick an area instead
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-ink/20 px-4 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // denied — most common stuck state. Browser remembered a prior block and
  // will keep auto-rejecting without prompting. Give clear platform-aware
  // instructions AND a one-tap escape into custom-location mode so users
  // are never wedged.
  const ios = isIOSLike();
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-coral/30 bg-coral-soft/40 px-5 py-6">
      <p className="font-serif text-lg text-ink">Location is blocked</p>
      <p className="text-xs text-ink-muted">
        Your browser is auto-blocking location for this site. Pick an area
        manually, or unblock and retry:
      </p>
      <ul className="list-disc pl-4 text-xs text-ink-muted">
        {ios ? (
          <>
            <li>
              iPhone: <strong>Settings → Privacy &amp; Security → Location
              Services → Safari</strong> → <strong>While Using</strong>, then
              reload this page.
            </li>
            <li>
              Installed as an app: <strong>Settings → Squad → Location</strong>{" "}
              → <strong>While Using</strong>.
            </li>
          </>
        ) : (
          <>
            <li>
              Tap the lock / site-info icon next to the URL → set{" "}
              <strong>Location</strong> to <strong>Allow</strong> → reload.
            </li>
            <li>
              Or: <strong>Site settings → Permissions → Location</strong> →
              <strong> Allow</strong>.
            </li>
          </>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPickCustom}
          className="rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          Pick an area instead
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-ink/20 px-4 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// Location-mode chip group + inline custom-search input. Stays compact so
// it sits comfortably above the plan-type / distance chip rows on a 380px
// viewport. The custom-input row only renders when mode === "custom" so
// the chrome doesn't bloat the "Here / Home" common path.
function LocationModeRow({
  mode,
  onChangeMode,
  home,
  custom,
  customQuery,
  onChangeCustomQuery,
  customStatus,
  onSubmitCustom,
  onClearCustom,
}: {
  mode: LocationMode;
  onChangeMode: (m: LocationMode) => void;
  home: CircleHome;
  custom: CustomLocation | null;
  customQuery: string;
  onChangeCustomQuery: (q: string) => void;
  customStatus:
    | { kind: "idle" }
    | { kind: "searching" }
    | { kind: "errored"; message: string };
  onSubmitCustom: () => void;
  onClearCustom: () => void;
}) {
  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-ink bg-ink text-paper-card"
        : "border-ink/15 bg-paper-card/40 text-ink hover:bg-paper-card",
    );
  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label="Search around"
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          Around
        </span>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "here"}
          onClick={() => onChangeMode("here")}
          className={chip(mode === "here")}
        >
          <Navigation className="size-3" aria-hidden />
          Here
        </button>
        {home ? (
          <button
            type="button"
            role="tab"
            aria-selected={mode === "home"}
            onClick={() => onChangeMode("home")}
            className={chip(mode === "home")}
          >
            <Home className="size-3" aria-hidden />
            {home.label ?? "Home"}
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={mode === "custom"}
          onClick={() => onChangeMode("custom")}
          className={chip(mode === "custom")}
        >
          <MapPin className="size-3" aria-hidden />
          {custom ? custom.label : "Other…"}
        </button>
      </div>
      {mode === "custom" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={customQuery}
              onChange={(e) => onChangeCustomQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmitCustom();
                }
              }}
              placeholder="Indiranagar Bangalore, MG Road…"
              aria-label="Search a place"
              className="flex-1 rounded-full border border-ink/15 bg-paper-card px-3 py-1.5 text-xs text-ink placeholder:text-ink-muted/70 focus:border-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            />
            <button
              type="button"
              onClick={onSubmitCustom}
              disabled={customStatus.kind === "searching"}
              className="inline-flex size-9 items-center justify-center rounded-full bg-ink text-paper-card transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral disabled:opacity-50"
              aria-label="Search"
            >
              <Search className="size-3.5" aria-hidden />
            </button>
            {custom ? (
              <button
                type="button"
                onClick={onClearCustom}
                className="inline-flex size-9 items-center justify-center rounded-full border border-ink/15 text-ink transition hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                aria-label="Clear location"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          {customStatus.kind === "searching" ? (
            <p className="text-[11px] text-ink-muted">Looking up…</p>
          ) : null}
          {customStatus.kind === "errored" ? (
            <p className="text-[11px] text-coral">{customStatus.message}</p>
          ) : null}
          {custom?.address && customStatus.kind === "idle" ? (
            <p className="text-[11px] text-ink-muted">{custom.address}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Empty state when the user has picked Home but the circle has no centroid
// set, or picked Other but hasn't searched yet. Distinct from the geo
// empty states (which only apply to Here mode).
function ModePromptEmptyState({
  mode,
  hasHome,
}: {
  mode: LocationMode;
  hasHome: boolean;
}) {
  if (mode === "home" && !hasHome) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-5 py-6">
        <p className="font-serif text-lg text-ink">No home set for this circle</p>
        <p className="text-xs text-ink-muted">
          An admin can set the home location in{" "}
          <strong>Settings → Home area</strong>. In the meantime, use
          <strong> Here</strong> or <strong>Other</strong>.
        </p>
      </div>
    );
  }
  if (mode === "custom") {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-5 py-6">
        <p className="font-serif text-lg text-ink">Pick a place to search around</p>
        <p className="text-xs text-ink-muted">
          Type a neighborhood, landmark, or address above and we&apos;ll find
          spots nearby.
        </p>
      </div>
    );
  }
  return null;
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
