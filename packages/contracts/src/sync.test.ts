import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureSchema, SyncStateSchema } from "./index";

const fixture = () =>
  JSON.parse(readFileSync("apps/web/public/fixtures/dashboard.json", "utf8"));

const healthy = {
  worker: { connected: true, last_heartbeat_at: "2026-09-13T11:59:00Z" },
  queued_jobs: 0,
  last_run: {
    started_at: "2026-09-13T11:00:00Z",
    ended_at: "2026-09-13T11:30:00Z",
    status: "succeeded",
    source: "youtube_data_api_public",
    error_code: null,
    coverage: { videos_seen: 3, comments_collected: 120, complete: true },
  },
};

describe("sync state contract", () => {
  it("accepts a well-formed state and the fixture's own block", () => {
    expect(SyncStateSchema.safeParse(healthy).success).toBe(true);
    expect(FixtureSchema.safeParse(fixture()).success).toBe(true);
  });

  it("falls back to null instead of failing the whole read", () => {
    // Sync health is not load-bearing. An unreadable status must not take the
    // dashboard down, and null is later classified as unknown, never healthy.
    const broken = {
      ...fixture(),
      sync: { worker: "yes please", queued_jobs: "many" },
    };
    const parsed = FixtureSchema.parse(broken);
    expect(parsed.sync).toBeNull();
    expect(parsed.comments.length).toBeGreaterThan(0);
  });

  it("refuses a run that is still going yet claims to have ended", () => {
    expect(
      SyncStateSchema.safeParse({
        ...healthy,
        last_run: { ...healthy.last_run, status: "running" },
      }).success,
    ).toBe(false);
    // Running with no end time is the coherent case.
    expect(
      SyncStateSchema.safeParse({
        ...healthy,
        last_run: { ...healthy.last_run, status: "running", ended_at: null },
      }).success,
    ).toBe(true);
  });

  it("refuses impossible counts and unknown fields", () => {
    expect(
      SyncStateSchema.safeParse({ ...healthy, queued_jobs: -1 }).success,
    ).toBe(false);
    expect(
      SyncStateSchema.safeParse({ ...healthy, surprise: true }).success,
    ).toBe(false);
    expect(
      SyncStateSchema.safeParse({
        ...healthy,
        last_run: { ...healthy.last_run, status: "complete" },
      }).success,
    ).toBe(false);
  });
});
