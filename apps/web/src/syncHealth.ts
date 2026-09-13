/**
 * Sync health, stated honestly.
 *
 * The specification is explicit that a worker on a closed laptop does not give
 * round-the-clock updates, and that a collection which stopped early is partial
 * or failed but never a successful empty dataset. So this classifies rather
 * than summarises: "succeeded" alone is not enough to call a channel current.
 *
 * The shape below is a local presentation model. The shared contract has no
 * sync_runs schema yet, so it is requested in the lane report and validated
 * here defensively instead of being assumed.
 */
export type RunStatus =
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "blocked";

export type SyncState = {
  worker: { connected: boolean; last_heartbeat_at: string | null };
  queued_jobs: number;
  last_run: {
    started_at: string;
    ended_at: string | null;
    status: RunStatus;
    source: string;
    error_code: string | null;
    coverage: {
      videos_seen: number;
      comments_collected: number;
      // Whether the source was traversed to its end. Never a claim that every
      // comment that exists was retrieved.
      complete: boolean;
    };
  } | null;
};

export type HealthKey =
  | "healthy"
  | "running"
  | "stale"
  | "partial"
  | "incomplete_coverage"
  | "failed"
  | "blocked"
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
  if (run.status === "failed" || run.status === "blocked")
    return {
      ...base,
      severity: "critical",
      key: run.status,
      queued,
      errorCode,
    };
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

/** Defensive parse: a malformed block reads as unknown, never as healthy. */
export function readSyncState(value: unknown): SyncState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const worker = v.worker as Record<string, unknown> | undefined;
  if (!worker || typeof worker.connected !== "boolean") return null;
  if (typeof v.queued_jobs !== "number") return null;
  const run = v.last_run as Record<string, unknown> | null | undefined;
  if (run === null || run === undefined)
    return {
      worker: {
        connected: worker.connected,
        last_heartbeat_at: (worker.last_heartbeat_at as string) ?? null,
      },
      queued_jobs: v.queued_jobs,
      last_run: null,
    };
  const coverage = run.coverage as Record<string, unknown> | undefined;
  if (typeof run.status !== "string" || !coverage) return null;
  return {
    worker: {
      connected: worker.connected,
      last_heartbeat_at: (worker.last_heartbeat_at as string) ?? null,
    },
    queued_jobs: v.queued_jobs,
    last_run: {
      started_at: run.started_at as string,
      ended_at: (run.ended_at as string) ?? null,
      status: run.status as RunStatus,
      source: (run.source as string) ?? "unknown",
      error_code: (run.error_code as string) ?? null,
      coverage: {
        videos_seen: Number(coverage.videos_seen ?? 0),
        comments_collected: Number(coverage.comments_collected ?? 0),
        complete: coverage.complete === true,
      },
    },
  };
}
