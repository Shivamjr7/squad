import { describe, expect, it } from "vitest";
import { overlaps, type TimeRange } from "./conflicts-overlap";

// Tiny helpers — easier to read than constructing Dates inline. UTC strings
// keep the cases timezone-agnostic.
const r = (startIso: string, endIso: string): TimeRange => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

describe("overlaps()", () => {
  const movie = r("2026-05-16T20:30:00Z", "2026-05-16T22:30:00Z");

  it("returns false when A ends before B starts (gap)", () => {
    const drinks = r("2026-05-16T23:00:00Z", "2026-05-17T01:00:00Z");
    expect(overlaps(movie, drinks)).toBe(false);
    expect(overlaps(drinks, movie)).toBe(false);
  });

  it("returns false when A and B are back-to-back at the boundary", () => {
    // movie ends 22:30, drinks starts 22:30 — touching but not overlapping.
    // Half-open semantics: adjacency is fine.
    const drinks = r("2026-05-16T22:30:00Z", "2026-05-17T00:30:00Z");
    expect(overlaps(movie, drinks)).toBe(false);
    expect(overlaps(drinks, movie)).toBe(false);
  });

  it("returns true for a 1-minute overlap at the edge", () => {
    const drinks = r("2026-05-16T22:29:00Z", "2026-05-17T00:29:00Z");
    expect(overlaps(movie, drinks)).toBe(true);
    expect(overlaps(drinks, movie)).toBe(true);
  });

  it("returns true when one plan is fully nested inside the other", () => {
    const coffee = r("2026-05-16T21:00:00Z", "2026-05-16T21:30:00Z");
    expect(overlaps(movie, coffee)).toBe(true);
    expect(overlaps(coffee, movie)).toBe(true);
  });

  it("returns true when plans share an identical window", () => {
    const duplicate = r("2026-05-16T20:30:00Z", "2026-05-16T22:30:00Z");
    expect(overlaps(movie, duplicate)).toBe(true);
  });

  it("returns false for a zero-length range that lands exactly on a boundary", () => {
    // Degenerate range — start === end. Half-open math: it has no interior so
    // it can't overlap anything that ends at or starts at the same instant.
    const tick = r("2026-05-16T20:30:00Z", "2026-05-16T20:30:00Z");
    expect(overlaps(movie, tick)).toBe(false);
    expect(overlaps(tick, movie)).toBe(false);
  });

  it("returns true for a zero-length range that lands strictly inside", () => {
    const tick = r("2026-05-16T21:00:00Z", "2026-05-16T21:00:00Z");
    // tick.start (21:00) < movie.end (22:30) ✓ and movie.start (20:30) <
    // tick.end (21:00) ✓ — instantaneous probe inside the window counts.
    expect(overlaps(movie, tick)).toBe(true);
  });
});
