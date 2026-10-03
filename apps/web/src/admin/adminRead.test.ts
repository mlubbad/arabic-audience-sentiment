import { describe, expect, it, vi, beforeEach } from "vitest";
import { readAdminServicesHealth } from "./adminRead";
import { readAdminCatalogue } from "../planCatalogue";
import * as supabaseModule from "../supabase";
import * as dataModule from "../data";

describe("adminRead honest live mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws in live mode when admin_services_health RPC fails instead of falling back to demo", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "PGRST000" },
    });
    vi.spyOn(supabaseModule, "supabase", "get").mockReturnValue({
      rpc: mockRpc,
    } as unknown as NonNullable<typeof supabaseModule.supabase>);

    await expect(readAdminServicesHealth({ isDemo: false })).rejects.toThrow();
  });

  it("marks unreported services as not_monitored in live mode", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        checked_at: new Date().toISOString(),
        database: { size_mb: 100, active_connections: 5 },
        worker: { fresh: true, jobs_queued: 0 },
        sync_24h: { youtube_runs: 10 },
      },
      error: null,
    });
    vi.spyOn(supabaseModule, "supabase", "get").mockReturnValue({
      rpc: mockRpc,
    } as unknown as NonNullable<typeof supabaseModule.supabase>);

    const report = await readAdminServicesHealth({ isDemo: false });
    // Reported services
    const pg = report.services.find((s) => s.id === "supabase_postgres");
    expect(pg?.status).toBe("healthy");
    const worker = report.services.find((s) => s.id === "python_worker");
    expect(worker?.status).toBe("healthy");

    // Unreported service must be not_monitored, NOT healthy
    const twitter = report.services.find((s) => s.id === "x_twitter_api");
    expect(twitter?.status).toBe("not_monitored");
  });

  it("throws in live mode when admin_plan_catalogue RPC fails instead of falling back to fixture", async () => {
    vi.spyOn(dataModule, "configuredMode", "get").mockReturnValue("live");
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied", code: "42501" },
    });
    vi.spyOn(supabaseModule, "supabase", "get").mockReturnValue({
      rpc: mockRpc,
    } as unknown as NonNullable<typeof supabaseModule.supabase>);

    await expect(readAdminCatalogue()).rejects.toThrow();
  });
});
