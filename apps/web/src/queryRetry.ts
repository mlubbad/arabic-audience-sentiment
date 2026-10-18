export function isStatementTimeout(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const err = error as {
      code?: string;
      message?: string;
      details?: unknown;
      cause?: unknown;
    };
    if (err.code === "57014") return true;
    if (
      typeof err.message === "string" &&
      (err.message.includes("57014") ||
        err.message.toLowerCase().includes("statement timeout") ||
        err.message
          .toLowerCase()
          .includes("canceling statement due to statement timeout"))
    ) {
      return true;
    }
    if (err.cause && isStatementTimeout(err.cause)) return true;
  }
  return false;
}

/**
 * The numbers are being computed in the background and are not ready yet. It is
 * a wait, not a failure: the page keeps its loading state and asks again.
 */
export class DashboardPendingError extends Error {
  constructor() {
    super("dashboard_pending");
    this.name = "DashboardPendingError";
  }
}

/** Asks again every PENDING_RETRY_MS for about three minutes, then gives up. */
export const PENDING_RETRY_MS = 3000;
const PENDING_MAX_RETRIES = 60;

export function shouldRetryDashboardQuery(
  failureCount: number,
  error: unknown,
  maxRetries = 2,
): boolean {
  if (error instanceof DashboardPendingError) {
    return failureCount < PENDING_MAX_RETRIES;
  }
  if (isStatementTimeout(error)) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  return failureCount < maxRetries;
}
