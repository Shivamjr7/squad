import { describe, expect, it } from "vitest";
import {
  canAutoLockFromInCount,
  canCastPlanVote,
  isPlanLapsed,
  removeVoteMode,
} from "./vote-policy";

describe("plan vote policy", () => {
  it("allows normal vote changes while active", () => {
    expect(
      canCastPlanVote({ planStatus: "active", previousVote: "in", nextVote: "maybe" }),
    ).toBe(true);
    expect(
      canCastPlanVote({ planStatus: "active", previousVote: null, nextVote: "out" }),
    ).toBe(true);
  });

  it("only allows out votes after a plan is confirmed", () => {
    expect(
      canCastPlanVote({ planStatus: "confirmed", previousVote: "in", nextVote: "out" }),
    ).toBe(true);
    expect(
      canCastPlanVote({ planStatus: "confirmed", previousVote: "in", nextVote: "maybe" }),
    ).toBe(false);
    expect(
      canCastPlanVote({ planStatus: "confirmed", previousVote: null, nextVote: "in" }),
    ).toBe(false);
  });

  it("blocks vote changes for terminal plans", () => {
    expect(
      canCastPlanVote({ planStatus: "done", previousVote: "in", nextVote: "out" }),
    ).toBe(false);
    expect(
      canCastPlanVote({ planStatus: "cancelled", previousVote: "maybe", nextVote: "out" }),
    ).toBe(false);
  });

  it("blocks vote changes after an active plan has lapsed", () => {
    expect(
      canCastPlanVote({
        planStatus: "active",
        previousVote: "maybe",
        nextVote: "in",
        isLapsed: true,
      }),
    ).toBe(false);
    expect(removeVoteMode("active", true)).toBe("blocked");
  });

  it("turns removal into out after confirmation", () => {
    expect(removeVoteMode("active")).toBe("delete");
    expect(removeVoteMode("confirmed")).toBe("mark-out");
    expect(removeVoteMode("done")).toBe("blocked");
    expect(removeVoteMode("cancelled")).toBe("blocked");
  });

  it("auto-locks only from affirmative in-count threshold", () => {
    expect(canAutoLockFromInCount({ inCount: 1, lockThreshold: 2 })).toBe(false);
    expect(canAutoLockFromInCount({ inCount: 2, lockThreshold: 2 })).toBe(true);
  });

  it("derives lapsed only for active plans after decide-by", () => {
    const now = new Date("2026-06-11T04:00:00.000Z");
    expect(
      isPlanLapsed({
        planStatus: "active",
        decideBy: new Date("2026-06-11T03:59:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      isPlanLapsed({
        planStatus: "active",
        decideBy: new Date("2026-06-11T04:01:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      isPlanLapsed({
        planStatus: "confirmed",
        decideBy: new Date("2026-06-11T03:59:00.000Z"),
        now,
      }),
    ).toBe(false);
  });
});
