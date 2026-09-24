/**
 * Sync health, stated honestly.
 *
 * The specification is explicit that a worker on a closed laptop does not give
 * round-the-clock updates, and that a collection which stopped early is partial
 * or failed but never a successful empty dataset. So this classifies rather
 * than summarises: "succeeded" alone is not enough to call a channel current.
 *
 * The shape lives in the shared contract; what a given shape *means* is
 * presentation and stays here.
 */
import { type SyncState } from "@sentiment/contracts";

export type { SyncState };

export type HealthKey =
  | "healthy"
  | "running"
  | "queued"
  | "stale"
  | "partial"
  | "incomplete_coverage"
  | "failed"
  | "blocked"
  | "quota_paused"
  | "stalled"
  | "never_run"
  | "never_run_no_worker"
  | "no_data";

export type Health = {
  severity: "ok" | "warning" | "critical" | "unknown";
  key: HealthKey;
  staleHours: number | null;
  queued: number;
  errorCode: string | null;
};

/** A gap beyond this is called out rather than presented as current. */
const STALE_AFTER_HOURS = 24;

export function syncHealth(state: SyncState | null, now: Date): Health {
  const base = { staleHours: null, queued: 0, errorCode: null };
  if (!state) return { ...base, severity: "unknown", key: "no_data" };
  const queued = state.queued_jobs;

  // Checked first: queued work with nobody to run it is the whole point of the
  // panel, and a healthy previous run must not hide it.
  if (queued > 0 && !state.worker.connected)
    return { ...base, severity: "critical", key: "stalled", queued };

  const run = state.last_run;
  if (!run)
    return state.worker.connected
      ? { ...base, severity: "warning", key: "never_run", queued }
      : { ...base, severity: "critical", key: "never_run_no_worker", queued };

  const errorCode = run.error_code;
  if (run.status === "running")
    return { ...base, severity: "ok", key: "running", queued };
  if (queued > 0)
    return { ...base, severity: "warning", key: "queued", queued, errorCode };

  if (run.status === "failed" || run.status === "blocked") {
    if (run.status === "blocked" && run.error_code === "quota_exceeded") {
      const endedDate = run.ended_at ? new Date(run.ended_at) : null;
      const isPastMidnightUtc =
        endedDate &&
        (now.getUTCFullYear() > endedDate.getUTCFullYear() ||
          now.getUTCMonth() > endedDate.getUTCMonth() ||
          now.getUTCDate() > endedDate.getUTCDate());

      if (isPastMidnightUtc) {
        return state.worker.connected
          ? { ...base, severity: "ok", key: "healthy", queued }
          : { ...base, severity: "warning", key: "stale", queued };
      }
      return {
        ...base,
        severity: "warning",
        key: "quota_paused",
        queued,
        errorCode,
      };
    }

    return {
      ...base,
      severity: "critical",
      key: run.status,
      queued,
      errorCode,
    };
  }
  if (run.status === "partial")
    return { ...base, severity: "warning", key: "partial", queued, errorCode };

  const staleHours = run.ended_at
    ? (now.getTime() - Date.parse(run.ended_at)) / 3_600_000
    : null;
  // Succeeded means the source stopped returning rows, not that everything was
  // retrieved, so unproven coverage outranks recency.
  if (!run.coverage.complete)
    return {
      ...base,
      severity: "warning",
      key: "incomplete_coverage",
      queued,
      staleHours,
    };
  if (staleHours !== null && staleHours >= STALE_AFTER_HOURS)
    return { ...base, severity: "warning", key: "stale", queued, staleHours };
  return { ...base, severity: "ok", key: "healthy", queued, staleHours };
}
