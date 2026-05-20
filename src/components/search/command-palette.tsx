"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Calendar, Search, Sparkles, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import { Pill } from "@/components/ui/pill";
import { circleDotClass } from "@/lib/circle-color";
import { cn } from "@/lib/utils";
import {
  searchUserScope,
  type SearchResult,
  type SearchCircleHit,
  type SearchMemberHit,
  type SearchPlanHit,
} from "@/lib/actions/search";

// Cmd-K / Ctrl-K global search palette. Mounted once in AppShell so the
// keyboard binding is live on every page. The palette itself only paints
// when open; closed state is just the keydown listener.
//
// Result flattening — three grouped lists collapse into a single linear
// `items` array for keyboard nav (↑/↓/Enter). Group headers are
// non-selectable separators rendered between segments.

const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

type FlatItem =
  | { kind: "plan"; data: SearchPlanHit; href: string }
  | { kind: "circle"; data: SearchCircleHit; href: string }
  | { kind: "member"; data: SearchMemberHit; href: string };

function flatten(result: SearchResult): FlatItem[] {
  const out: FlatItem[] = [];
  for (const p of result.plans) {
    out.push({
      kind: "plan",
      data: p,
      href: `/c/${p.circleSlug}/p/${p.id}`,
    });
  }
  for (const c of result.circles) {
    out.push({ kind: "circle", data: c, href: `/c/${c.slug}` });
  }
  for (const m of result.members) {
    out.push({
      kind: "member",
      data: m,
      href: `/c/${m.sharedCircleSlug}/squad`,
    });
  }
  return out;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult>({
    plans: [],
    circles: [],
    members: [],
  });
  // The query string the displayed `result` corresponds to. Without this,
  // a fresh keystroke makes `query !== ""` and `result.items === 0`
  // simultaneously — which would flash "No matches" until the async search
  // returns. We only show the empty state when settledQuery matches.
  const [settledQuery, setSettledQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Each search bumps this id; results from older queries are dropped to
  // avoid the "user typed quickly and a stale slow query overwrote a fresh
  // one" race.
  const queryIdRef = useRef(0);

  // Global Cmd-K / Ctrl-K binding. Toggles the palette regardless of
  // which page is mounted. Skip when an editable field already owns focus
  // so the user's typing in a textarea isn't hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (k !== "k") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    // External-open hook — any component (e.g. the mobile search button)
    // can `window.dispatchEvent(new Event("squad:open-command-palette"))`
    // to surface the palette without needing a ref into this component.
    function onOpenEvent() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("squad:open-command-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("squad:open-command-palette", onOpenEvent);
    };
  }, []);

  // Run the search. Trims + skips empty; debounced informally by the
  // input change event (no setTimeout — keystrokes already pace this).
  useEffect(() => {
    const trimmed = query.trim();
    if (!open) return;
    if (trimmed.length === 0) {
      setResult({ plans: [], circles: [], members: [] });
      setSettledQuery("");
      setActiveIndex(0);
      return;
    }
    const id = ++queryIdRef.current;
    startTransition(async () => {
      try {
        const r = await searchUserScope(trimmed);
        if (id !== queryIdRef.current) return;
        setResult(r);
        setSettledQuery(trimmed);
        setActiveIndex(0);
      } catch {
        // Silent — palette is best-effort.
      }
    });
  }, [query, open]);

  // Reset transient state when the palette closes so a re-open is fresh.
  useEffect(() => {
    if (open) {
      // Focus the input shortly after Radix mounts the content. Direct
      // requestAnimationFrame is enough — the dialog opens synchronously.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setResult({ plans: [], circles: [], members: [] });
      setSettledQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const items = useMemo(() => flatten(result), [result]);

  const onSelect = useCallback(
    (item: FlatItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) onSelect(item);
    }
  }

  const trimmedQuery = query.trim();
  const showHint = trimmedQuery.length === 0;
  // Only declare "no matches" once the displayed result corresponds to the
  // current query AND nothing is in flight. Otherwise the previous result
  // (or nothing on the very first keystroke) would flash an empty state
  // until the async search returns.
  const resultsSettled = settledQuery === trimmedQuery && !isPending;
  const empty = items.length === 0 && resultsSettled;
  const showLoadingPlaceholder =
    !showHint && items.length === 0 && !resultsSettled;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[20%] max-w-[560px] translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-2xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search Squad</DialogTitle>

        <div className="flex items-center gap-2 border-b border-ink-hairline px-4 py-3">
          <Search className="size-4 text-ink-muted" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find a plan, circle, or person…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="hidden shrink-0 select-none rounded border border-ink-subtle bg-paper-card px-1.5 py-0.5 font-mono text-[10px] text-ink-muted sm:inline">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {showHint ? (
            <PaletteHint />
          ) : showLoadingPlaceholder ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              Searching…
            </p>
          ) : empty ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <PaletteResults
              items={items}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              onSelect={onSelect}
              groups={result}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteHint() {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-6 text-sm text-ink-muted">
      <p className="flex items-center gap-2">
        <Sparkles className="size-3.5" aria-hidden />
        Type to search plans, circles, and people you share circles with.
      </p>
      <p className="text-xs">
        <kbd className="rounded border border-ink-subtle bg-paper-card px-1.5 py-0.5 font-mono text-[10px]">
          ↑
        </kbd>{" "}
        <kbd className="rounded border border-ink-subtle bg-paper-card px-1.5 py-0.5 font-mono text-[10px]">
          ↓
        </kbd>{" "}
        to navigate ·{" "}
        <kbd className="rounded border border-ink-subtle bg-paper-card px-1.5 py-0.5 font-mono text-[10px]">
          ↵
        </kbd>{" "}
        to open
      </p>
    </div>
  );
}

function PaletteResults({
  items,
  activeIndex,
  setActiveIndex,
  onSelect,
  groups,
}: {
  items: FlatItem[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onSelect: (item: FlatItem) => void;
  groups: SearchResult;
}) {
  // Walk items and emit group dividers as the kind changes — keeps the
  // flat array authoritative for keyboard nav, lets the render add the
  // section breaks for free.
  const labelByKind: Record<FlatItem["kind"], string> = {
    plan: groups.plans.length === 1 ? "Plan" : "Plans",
    circle: groups.circles.length === 1 ? "Circle" : "Circles",
    member: groups.members.length === 1 ? "Person" : "People",
  };
  let lastKind: FlatItem["kind"] | null = null;
  return (
    <ul className="py-1" role="listbox">
      {items.map((item, i) => {
        const showHeader = item.kind !== lastKind;
        lastKind = item.kind;
        const active = i === activeIndex;
        return (
          <li key={`${item.kind}-${itemKey(item)}`}>
            {showHeader ? (
              <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                {labelByKind[item.kind]}
              </div>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
                active ? "bg-coral-soft/60 text-ink" : "text-ink hover:bg-paper-card",
              )}
            >
              <Row item={item} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function itemKey(item: FlatItem): string {
  switch (item.kind) {
    case "plan":
      return item.data.id;
    case "circle":
      return item.data.id;
    case "member":
      return item.data.userId;
  }
}

function Row({ item }: { item: FlatItem }) {
  if (item.kind === "plan") {
    const start = new Date(item.data.startsAt);
    const isFuture = start.getTime() > Date.now();
    return (
      <>
        <Calendar
          className="size-4 shrink-0 text-ink-muted"
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{item.data.title}</span>
          <span className="truncate text-xs text-ink-muted">
            {item.data.circleName} · {SHORT_TIME.format(start)}
          </span>
        </span>
        <Pill
          tone={item.data.status === "confirmed" ? "in" : isFuture ? "coral" : "muted"}
          size="sm"
          variant="outline"
        >
          {item.data.status === "confirmed"
            ? "Locked"
            : item.data.status === "cancelled"
              ? "Cancelled"
              : isFuture
                ? "Upcoming"
                : "Past"}
        </Pill>
      </>
    );
  }
  if (item.kind === "circle") {
    return (
      <>
        <span
          aria-hidden
          className={cn("size-3 shrink-0 rounded-full", circleDotClass(item.data.id))}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{item.data.name}</span>
          <span className="truncate text-xs text-ink-muted">
            {item.data.memberCount}{" "}
            {item.data.memberCount === 1 ? "person" : "people"}
          </span>
        </span>
        <Users className="size-3.5 text-ink-muted" aria-hidden />
      </>
    );
  }
  // member
  return (
    <>
      <GradientAvatar
        seed={item.data.userId}
        name={item.data.displayName}
        src={item.data.avatarUrl}
        size="sm"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.data.displayName}</span>
      </span>
    </>
  );
}
