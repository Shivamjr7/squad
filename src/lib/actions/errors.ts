export type ActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "EXPIRED"
  | "RATE_LIMITED";

export class ActionError extends Error {
  constructor(
    public code: ActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export function isActionError(err: unknown): err is ActionError {
  return err instanceof Error && err.name === "ActionError";
}
