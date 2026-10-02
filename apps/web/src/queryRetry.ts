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

export function shouldRetryDashboardQuery(
  failureCount: number,
  error: unknown,
  maxRetries = 2,
): boolean {
  if (isStatementTimeout(error)) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  return failureCount < maxRetries;
}
