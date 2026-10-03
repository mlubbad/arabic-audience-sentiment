import { describe, expect, it } from "vitest";
import { syncHealth, type SyncState } from "./syncHealth";

const now = new Date("2026-09-13T12:00:00Z");
const state = (over: Partial<SyncState> = {}): SyncState => ({
  worker: {
    connected: true,
    busy: false,
    last_heartbeat_at: "2026-09-13T11:59:00Z",
  },
  queued_jobs: 0,
  last_run: {
    started_at: "2026-09-13T11:00:00Z",
    ended_at: "2026-09-13T11:30:00Z",
    status: "succeeded",
    source: "youtube_data_api_public",
    error_code: null,
    coverage: { videos_seen: 3, comments_collected: 120, complete: true },
  },
  ...over,
});

describe("sync health", () => {
  it("is healthy only when a complete run finished recently with a worker", () => {
    expect(syncHealth(state(), now)).toMatchObject({
      severity: "ok",
      key: "healthy",
    });
  });

  it("never reports a partial collection as a success", () => {
    const partial = state({
      last_run: { ...state().last_run!, status: "partial" },
    });
    expect(syncHealth(partial, now)).toMatchObject({
      severity: "warning",
      key: "partial",
    });
  });

  it("does not call a run complete when coverage was not established", () => {
    const run = state().last_run!;
    const unproven = state({
      last_run: { ...run, coverage: { ...run.coverage, complete: false } },
    });
    // Succeeded means the source stopped returning rows, not that everything
    // was retrieved.
    expect(syncHealth(unproven, now)).toMatchObject({
      severity: "warning",
      key: "incomplete_coverage",
    });
  });

  it("surfaces a failed or blocked run as critical with its code", () => {
    for (const status of ["failed", "blocked"] as const) {
      const bad = state({
        last_run: {
          ...state().last_run!,
          status,
          error_code: "source_access_denied",
        },
      });
      expect(syncHealth(bad, now)).toMatchObject({
        severity: "critical",
        key: status,
        errorCode: "source_access_denied",
      });
    }
  });

  it("treats queued work with a connected worker as queued rather than a fatal blocker", () => {
    const retrying = state({
      queued_jobs: 2,
      last_run: {
        ...state().last_run!,
        status: "blocked",
        error_code: "quota_exceeded",
      },
    });
    expect(syncHealth(retrying, now)).toMatchObject({
      severity: "warning",
      key: "queued",
      queued: 2,
      errorCode: "quota_exceeded",
    });
  });

  it("treats queued work with no worker as stalled, whatever the last run said", () => {
    const stalled = state({
      queued_jobs: 4,
      worker: {
        connected: false,
        busy: false,
        last_heartbeat_at: "2026-09-12T09:00:00Z",
      },
    });
    // A healthy previous run must not hide the fact that nothing is progressing.
    expect(syncHealth(stalled, now)).toMatchObject({
      severity: "critical",
      key: "stalled",
      queued: 4,
    });
  });

  it("calls a long gap stale rather than healthy", () => {
    const old = state({
      last_run: {
        ...state().last_run!,
        started_at: "2026-09-11T11:30:00Z",
        ended_at: "2026-09-11T12:00:00Z",
      },
    });
    const result = syncHealth(old, now);
    expect(result).toMatchObject({ severity: "warning", key: "stale" });
    expect(result.staleHours).toBe(48);
  });

  it("distinguishes never-run with a worker from never-run without one", () => {
    expect(syncHealth(state({ last_run: null }), now)).toMatchObject({
      severity: "warning",
      key: "never_run",
    });
    expect(
      syncHealth(
        state({
          last_run: null,
          worker: { connected: false, busy: false, last_heartbeat_at: null },
        }),
        now,
      ),
    ).toMatchObject({ severity: "critical", key: "never_run_no_worker" });
  });

  it("reports absent data as unknown rather than as healthy or broken", () => {
    expect(syncHealth(null, now)).toMatchObject({
      severity: "unknown",
      key: "no_data",
    });
  });

  it("reports a run still in progress without guessing its outcome", () => {
    const running = state({
      last_run: { ...state().last_run!, status: "running", ended_at: null },
    });
    expect(syncHealth(running, now)).toMatchObject({
      severity: "ok",
      key: "running",
    });
    expect(syncHealth(running, now).staleHours).toBeNull();
  });

  it("reports quota_paused when blocked by quota_exceeded on the same UTC day", () => {
    const blockedQuota = state({
      queued_jobs: 0,
      last_run: {
        ...state().last_run!,
        status: "blocked",
        error_code: "quota_exceeded",
        ended_at: "2026-09-12T10:00:00Z",
      },
    });
    const sameDay = new Date("2026-09-12T18:00:00Z");
    expect(syncHealth(blockedQuota, sameDay)).toMatchObject({
      severity: "warning",
      key: "quota_paused",
      errorCode: "quota_exceeded",
    });
  });

  it("reports stale when blocked by quota 10 days ago with no run since, even if worker is connected", () => {
    const blockedQuota = state({
      queued_jobs: 0,
      worker: {
        connected: true,
        busy: false,
        last_heartbeat_at: "2026-09-22T10:00:00Z",
      },
      last_run: {
        ...state().last_run!,
        status: "blocked",
        error_code: "quota_exceeded",
        ended_at: "2026-09-12T10:00:00Z",
      },
    });
    const tenDaysLater = new Date("2026-09-22T10:00:00Z");
    const health = syncHealth(blockedQuota, tenDaysLater);
    expect(health).toMatchObject({
      severity: "warning",
      key: "stale",
    });
    expect(health.staleHours).toBe(240);
  });

  it("handles Dec 31 to Jan 1 rollover correctly for quota reset", () => {
    const blockedOnNewYearsEve = state({
      queued_jobs: 0,
      last_run: {
        ...state().last_run!,
        status: "blocked",
        error_code: "quota_exceeded",
        ended_at: "2026-12-31T20:00:00Z",
      },
    });
    // Same day before reset
    const sameDay = new Date("2026-12-31T23:30:00Z");
    expect(syncHealth(blockedOnNewYearsEve, sameDay)).toMatchObject({
      severity: "warning",
      key: "quota_paused",
    });
    // Jan 1 after reset: past reset time with no run -> stale
    const nextDayJan1 = new Date("2027-01-01T00:30:00Z");
    expect(syncHealth(blockedOnNewYearsEve, nextDayJan1)).toMatchObject({
      severity: "warning",
      key: "stale",
    });
  });
});
