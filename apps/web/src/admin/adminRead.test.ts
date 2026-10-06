import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("../supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { buildLiveServicesReport, readAdminServicesHealth } from "./adminRead";
import { getDemoServicesHealth } from "./adminServicesDemo";
import { failureCode } from "../failure";

beforeEach(() => rpc.mockReset());

describe("buildLiveServicesReport", () => {
  const live = buildLiveServicesReport(
    {
      checked_at: "2026-10-05T12:00:00Z",
      database: { size_mb: 300, active_connections: 7 },
      worker: { fresh: false, jobs_queued: 4 },
    },
    31,
  );
  const byId = (id: string) => live.services.find((s) => s.id === id)!;

  it("marks every service without live telemetry not_monitored, never healthy", () => {
    const unmeasured = live.services.filter(
      (s) => s.id !== "supabase_postgres" && s.id !== "python_worker",
    );
    expect(unmeasured.length).toBe(getDemoServicesHealth().services.length - 2);
    for (const s of unmeasured) {
      expect(s.status).toBe("not_monitored");
      expect(s.latency_ms).toBeNull();
      expect(s.quota_used).toBeNull();
    }
  });

  it("draws no demo allowance as a live limit", () => {
    // The demo's 1,024 MB database and 100-job queue showed as real limits.
    for (const s of live.services) expect(s.quota_total).toBeNull();
  });

  it("does not invent a YouTube quota from the run count", () => {
    expect(byId("youtube_api").quota_used).toBeNull();
  });

  it("fills only what the server measured", () => {
    expect(byId("supabase_postgres")).toMatchObject({
      status: "healthy",
      latency_ms: 31,
      quota_used: 300,
    });
    expect(byId("python_worker")).toMatchObject({
      status: "degraded",
      quota_used: 4,
    });
  });

  it("derives the overall status and summary from the monitored services", () => {
    expect(live.overall_status).toBe("degraded");
    expect(live.summary).toMatchObject({
      total: live.services.length,
      healthy: 1,
      degraded: 1,
      not_monitored: live.services.length - 2,
      avg_latency_ms: 31,
    });
  });

  it("leaves the worker not_monitored when the server sent no worker reading", () => {
    const empty = buildLiveServicesReport({}, 10);
    // The database answered (it is the RPC), so it alone is measured.
    expect(empty.overall_status).toBe("healthy");
    const worker = empty.services.find((s) => s.id === "python_worker")!;
    expect(worker.status).toBe("not_monitored");
  });
});

describe("readAdminServicesHealth (live)", () => {
  it("throws on an RPC error instead of returning the demo report", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(readAdminServicesHealth()).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("throws when the RPC returns nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(readAdminServicesHealth()).rejects.toThrow("live_unavailable");
  });

  it("names the database's code on the page, not `unexpected`", async () => {
    // Production answered PGRST202 for a function its migration history
    // recorded but its catalogue did not hold (2026-10-05).
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const error = await readAdminServicesHealth().catch((e: unknown) => e);
    expect(failureCode("read", error)).toBe("read:live_unavailable:PGRST202");
  });

  it("returns the demo report only when asked for it", async () => {
    const demo = await readAdminServicesHealth({ isDemo: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(demo.services.every((s) => s.status !== "not_monitored")).toBe(true);
  });
});
