import { describe, expect, it, vi, beforeEach } from "vitest";
import { readAdminServicesHealth } from "./adminRead";
import { supabase } from "../supabase";

vi.mock("../supabase", () => {
  return {
    supabase: {
      rpc: vi.fn(),
    },
  };
});

type RpcReturn = ReturnType<NonNullable<typeof supabase>["rpc"]>;

function mockRpcData(data: unknown): RpcReturn {
  return Promise.resolve({ data, error: null }) as unknown as RpcReturn;
}

function mockRpcError(message: string, code = "P0001"): RpcReturn {
  return Promise.resolve({
    data: null,
    error: { message, code, details: "", hint: "" },
  }) as unknown as RpcReturn;
}

describe("readAdminServicesHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns demo report when isDemo is true", async () => {
    const report = await readAdminServicesHealth({ isDemo: true });
    expect(report.overall_status).toBe("healthy");
    expect(report.summary.total).toBe(15);
    expect(report.summary.unconfigured).toBe(0);
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it("reports live telemetry and marks unmonitored services unconfigured", async () => {
    vi.mocked(supabase!.rpc).mockReturnValueOnce(
      mockRpcData({
        checked_at: "2026-10-02T06:00:00Z",
        database: {
          status: "healthy",
          size_mb: 150,
          active_connections: 8,
          rls_enforced: true,
        },
        worker: {
          fresh: true,
          last_seen_at: "2026-10-02T05:59:00Z",
          jobs_queued: 2,
          jobs_running: 1,
        },
        sync_24h: {
          total_runs: 5,
          failed_runs: 0,
          youtube_runs: 5,
        },
      }),
    );

    const report = await readAdminServicesHealth({ isDemo: false });
    expect(supabase!.rpc).toHaveBeenCalledWith("admin_services_health");

    // Only postgres, worker, and youtube are active/configured
    const pg = report.services.find((s) => s.id === "supabase_postgres");
    expect(pg?.status).toBe("healthy");
    expect(pg?.latency_ms).toBeGreaterThanOrEqual(0);
    expect(pg?.quota_used).toBe(150);

    const worker = report.services.find((s) => s.id === "python_worker");
    expect(worker?.status).toBe("healthy");
    expect(worker?.latency_ms).toBeNull();
    expect(worker?.quota_used).toBe(2);

    const yt = report.services.find((s) => s.id === "youtube_api");
    expect(yt?.status).toBe("healthy");
    expect(yt?.latency_ms).toBeNull();
    expect(yt?.quota_used).toBe(500);

    // The other 12 services must be unconfigured
    const unconfigured = report.services.filter(
      (s) => s.status === "unconfigured",
    );
    expect(unconfigured.length).toBe(12);
    for (const service of unconfigured) {
      expect(service.latency_ms).toBeNull();
      expect(service.quota_used).toBeNull();
      expect(service.endpoint).toBeNull();
    }

    expect(report.summary.unconfigured).toBe(12);
    expect(report.summary.healthy).toBe(3);
    expect(report.summary.degraded).toBe(0);
    expect(report.summary.down).toBe(0);
    expect(report.overall_status).toBe("healthy");
  });

  it("handles rpc error by marking postgres as down rather than faking demo health", async () => {
    vi.mocked(supabase!.rpc).mockReturnValueOnce(
      mockRpcError("connection refused", "57P01"),
    );

    const report = await readAdminServicesHealth({ isDemo: false });
    const pg = report.services.find((s) => s.id === "supabase_postgres");
    expect(pg?.status).toBe("down");
    expect(pg?.error_code).toBe("57P01");
    expect(report.overall_status).toBe("down");
    expect(report.summary.down).toBe(1);
    expect(report.summary.unconfigured).toBe(14);
  });
});
