import { describe, expect, it } from "vitest";
import {
  canAutoLockFromInCount,
  canCastPlanVote,
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
});
