import { describe, expect, it } from "vitest";
import { OpsSnapshotSchema, OpsVideoCountSchema } from "./index";

describe("ops contract", () => {
  it("accepts a well-formed ops snapshot", () => {
    const valid = {
      sync: {
        worker: {
          connected: true,
          last_heartbeat_at: "2026-09-19T20:00:00Z",
          busy: false,
        },
        queued_jobs: 0,
        last_run: null,
      },
      plan: {
        plan_key: "free",
        status: "active",
        period_start: "2026-09-01T00:00:00Z",
        period_end: "2026-10-01T00:00:00Z",
        budgets: [
          {
            event_type: "comment_analysis",
            used: 250,
            allowance: 1000,
            granted: 0,
            remaining: 750,
          },
        ],
      },
      video_counts: [
        { id: "vid-1", total: 42 },
        { id: "vid-2", total: 0 },
      ],
    };
    const parsed = OpsSnapshotSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("allows null sync and null plan with non-empty video counts", () => {
    const valid = {
      sync: null,
      plan: null,
      video_counts: [{ id: "v1", total: 10 }],
    };
    expect(OpsSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative totals in video counts", () => {
    expect(OpsVideoCountSchema.safeParse({ id: "v1", total: -1 }).success).toBe(
      false,
    );
  });
});
