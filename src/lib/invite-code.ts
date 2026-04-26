import { randomBytes } from "node:crypto";

// 9 random bytes → 12 base64url characters (no padding). Meets the
// PLAN.md §12 requirement of ≥12 chars and cryptographically random.
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}
