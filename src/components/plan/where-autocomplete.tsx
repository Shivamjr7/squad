"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchPlaces,
  type PlaceSearchResult,
} from "@/lib/actions/suggest-location";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

type Props = {
  circleId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  // Hooked into the form's accessibility ID so screen readers announce
  // "where, primary input" vs "where, option 2 input" correctly.
  ariaLabel?: string;
  // Optional callback when the user picks a result (vs free-typing). The
  // form can use this later to capture provenance; today it's a no-op for
  // the single-venue case — see FIXES_PLAN.md §5 for the scope decision.
  onPick?: (result: PlaceSearchResult) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: PlaceSearchResult[] }
  | { kind: "empty" }
  | { kind: "disabled" }; // Provider missing — silent fallback to plain input.

// Replaces the WHERE-field plain <Input> in NewPlanForm with a Google
// Places-backed autocomplete dropdown. UX is intentionally close to the
// underlying input: typing freely is always allowed (the dropdown is a
// suggestion layer), Enter on a focused result fills the input, Escape
// closes the dropdown without losing the typed value.
//
// The provider key (GOOGLE_PLACES_API_KEY) is server-side only — calls go
// through the searchPlaces server action which gates on membership. If the
// key is missing, the first response is `{ ok: false, reason: "unconfigured" }`
// and the component flips permanently to "disabled" for the session so the
// user gets a plain input back. No exception, no log spam.
export function WhereAutocomplete({
  circleId,
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  ariaLabel,
  onPick,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [disabled, setDisabled] = useState(false);

  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recent query the user has committed to via input event.
  // We drop stale responses by comparing on resolve.
  const lastQueryRef = useRef("");
  // Suppresses the next fetch — toggled when we accept a result (otherwise
  // setValue immediately re-triggers the debounce and re-opens the dropdown
  // showing the same hits we just picked from).
  const skipNextFetchRef = useRef(false);

  // Cancel in-flight + debounced fetches on unmount so we don't setState
  // on an unmounted component after a slow Places response.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Click-outside → close. We compare against the container ref rather
  // than the input alone so clicks inside the dropdown stay open until the
  // option's own handler runs.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const node = containerRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOpen(false);
        setHighlight(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const runSearch = useCallback(
    async (query: string) => {
      // Trim + min-length guard mirrors the server-side validation so we
      // skip provably-failing calls.
      const trimmed = query.trim();
      if (trimmed.length < MIN_QUERY_LEN) {
        setStatus({ kind: "idle" });
        return;
      }
      // Cancel previous in-flight (different query). Server-side
      // searchPlaces uses AbortController internally — fetch() respects the
      // signal even though our action call doesn't surface it directly.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus({ kind: "loading" });
      try {
        const result = await searchPlaces({ circleId, query: trimmed });
        // Stale-response guard.
        if (ac.signal.aborted) return;
        if (lastQueryRef.current !== query) return;
        if (!result.ok) {
          // Provider not configured (GOOGLE_PLACES_API_KEY missing) —
          // disable for the rest of the session. Tagged result, not an
          // exception, so no server-action digest.
          setDisabled(true);
          setStatus({ kind: "disabled" });
          setOpen(false);
          return;
        }
        if (result.results.length === 0) {
          setStatus({ kind: "empty" });
        } else {
          setStatus({ kind: "results", results: result.results });
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        void err;
        setStatus({ kind: "empty" });
      }
    },
    [circleId],
  );

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    onChange(next);
    if (disabled) return;
    if (skipNextFetchRef.current) {
      // First change after a pick — clear the flag and skip exactly one
      // fetch so the dropdown doesn't reopen with the same row the user
      // just chose.
      skipNextFetchRef.current = false;
      setOpen(false);
      return;
    }
    lastQueryRef.current = next;
    setHighlight(-1);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(next), DEBOUNCE_MS);
  }

  function acceptResult(result: PlaceSearchResult) {
    skipNextFetchRef.current = true;
    onChange(result.label);
    onPick?.(result);
    setOpen(false);
    setHighlight(-1);
    setStatus({ kind: "idle" });
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (status.kind !== "results") {
      // Down-arrow with a non-empty input re-opens a previously-closed
      // dropdown if there's an existing result set we lost track of.
      if (e.key === "ArrowDown" && value.trim().length >= MIN_QUERY_LEN) {
        setOpen(true);
      }
      return;
    }
    const items = status.results;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % items.length);
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? items.length - 1 : i - 1));
      setOpen(true);
    } else if (e.key === "Enter" && open && highlight >= 0) {
      e.preventDefault();
      acceptResult(items[highlight]!);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setHighlight(-1);
      }
    }
  }

  function onFocus() {
    if (disabled) return;
    // Re-open if we have a usable result set from a prior session of
    // typing — saves a re-fetch when the user tabs away and back.
    if (status.kind === "results" && status.results.length > 0) {
      setOpen(true);
    }
  }

  const showDropdown =
    open && !disabled && status.kind !== "idle" && status.kind !== "disabled";
  const activeResults =
    status.kind === "results" ? status.results : [];
  const activeDescendantId =
    showDropdown && highlight >= 0
      ? `${listboxId}-option-${highlight}`
      : undefined;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Native input so the ref attaches directly. NewPlanForm already
          passes a Tailwind class string matching the rest of the form's
          underlined input style — we forward it as-is. */}
      <input
        ref={inputRef}
        type="text"
        // ARIA 1.2 combobox pattern: aria-expanded/controls/activedescendant
        // are only valid on role="combobox", not the implicit textbox role.
        // Without the explicit role, jsx-a11y/role-supports-aria-props flags
        // the attributes as invalid.
        role="combobox"
        value={value}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={100}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={activeDescendantId}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
          inputClassName,
        )}
      />
      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-ink/15 bg-paper-card shadow-card-raised"
        >
          {status.kind === "loading" ? (
            <div className="px-3 py-2 text-xs text-ink-muted">Searching…</div>
          ) : status.kind === "empty" ? (
            <div className="px-3 py-2 text-xs text-ink-muted">
              No matches — keep what you typed.
            </div>
          ) : (
            activeResults.map((result, i) => {
              const isHighlighted = i === highlight;
              return (
                <button
                  key={`${result.placeId ?? result.label}-${i}`}
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={isHighlighted}
                  type="button"
                  // onMouseDown (not onClick) so the input doesn't lose
                  // focus and trigger the click-outside handler before the
                  // pick handler runs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptResult(result);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                    isHighlighted ? "bg-paper" : "hover:bg-paper",
                  )}
                >
                  <MapPin
                    className="mt-0.5 size-3.5 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-ink">
                      {result.label}
                    </span>
                    {result.address ? (
                      <span className="truncate text-[11px] text-ink-muted">
                        {result.address}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
