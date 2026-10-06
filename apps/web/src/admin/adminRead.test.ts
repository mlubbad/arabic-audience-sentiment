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
  const now = new Date("2026-10-10T12:00:00Z");
  const platform = (overrides: Record<string, unknown> = {}) => ({
    last_status: "succeeded",
    last_finished_at: "2026-10-10T11:00:00Z",
    last_success_at: "2026-10-10T11:00:00Z",
    last_failure_at: null,
    last_error_code: null,
    runs_24h: 4,
    failures_24h: 0,
    consecutive_failures: 0,
    ...overrides,
  });
  const build = (
    overrides: Parameters<typeof buildLiveServicesReport>[0] = {},
  ) =>
    buildLiveServicesReport(
      {
        checked_at: now.toISOString(),
        database: { size_mb: 300, active_connections: 7 },
        ...overrides,
      },
      31,
      now,
    );
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

  it("leaves all record-backed services not_monitored for an older RPC", () => {
    const report = build();
    for (const id of [
      "youtube_api",
      "telegram_api",
      "x_twitter_api",
      "tiktok_api",
      "paddle_billing",
    ]) {
      expect(report.services.find((service) => service.id === id)!.status).toBe(
        "not_monitored",
      );
    }
  });

  it("maps every platform and keeps an exact 48-hour success healthy", () => {
    const exact48Hours = "2026-10-08T12:00:00Z";
    const report = build({
      platforms: {
        youtube: platform({ last_success_at: exact48Hours }),
        telegram: platform(),
        x: platform(),
        tiktok: platform(),
      },
    });
    for (const id of [
      "youtube_api",
      "telegram_api",
      "x_twitter_api",
      "tiktok_api",
    ]) {
      const service = report.services.find((item) => item.id === id)!;
      expect(service.status).toBe("healthy");
      expect(service.latency_ms).toBeNull();
      expect(service.quota_used).toBeNull();
      expect(service.quota_total).toBeNull();
    }
  });

  it("degrades a platform one millisecond beyond the 48-hour edge", () => {
    const report = build({
      platforms: {
        youtube: platform({ last_success_at: "2026-10-08T11:59:59.999Z" }),
      },
    });
    expect(
      report.services.find((service) => service.id === "youtube_api"),
    ).toMatchObject({ status: "degraded", error_code: null });
  });

  it.each(["failed", "blocked", "partial"])(
    "degrades a platform whose latest run is %s",
    (lastStatus) => {
      const report = build({
        platforms: {
          telegram: platform({
            last_status: lastStatus,
            last_failure_at: "2026-10-10T11:00:00Z",
            last_error_code: "provider_error",
          }),
        },
      });
      expect(
        report.services.find((service) => service.id === "telegram_api"),
      ).toMatchObject({
        status: "degraded",
        error_code: "provider_error",
      });
    },
  );

  it("marks three consecutive failures down", () => {
    const report = build({
      platforms: {
        x: platform({
          last_status: "failed",
          last_failure_at: "2026-10-10T11:00:00Z",
          last_error_code: "provider_error",
          consecutive_failures: 3,
        }),
      },
    });
    expect(
      report.services.find((service) => service.id === "x_twitter_api"),
    ).toMatchObject({ status: "down", error_code: "provider_error" });
  });

  it("marks a latest quota code down and exposes that code", () => {
    const report = build({
      platforms: {
        tiktok: platform({
          last_status: "failed",
          last_failure_at: "2026-10-10T11:00:00Z",
          last_error_code: "APIFY_QUOTA_DEPLETED",
        }),
      },
    });
    expect(
      report.services.find((service) => service.id === "tiktok_api"),
    ).toMatchObject({ status: "down", error_code: "APIFY_QUOTA_DEPLETED" });
  });

  it("does not let an older quota failure override a newer success", () => {
    const report = build({
      platforms: {
        youtube: platform({
          last_failure_at: "2026-10-10T10:00:00Z",
          last_error_code: "quota_exceeded",
        }),
      },
    });
    expect(
      report.services.find((service) => service.id === "youtube_api")!.status,
    ).toBe("healthy");
  });

  it("keeps the exact seven-day edge monitored and explains a missing seven-day run", () => {
    const fsi = String.fromCodePoint(0x2068);
    const pdi = String.fromCodePoint(0x2069);
    const report = build({
      platforms: {
        youtube: platform({
          last_finished_at: "2026-10-03T12:00:00Z",
          last_success_at: "2026-10-10T11:00:00Z",
        }),
        telegram: platform({
          last_status: null,
          last_finished_at: null,
          last_success_at: null,
          runs_24h: 0,
        }),
      },
    });
    const youtube = report.services.find(
      (service) => service.id === "youtube_api",
    )!;
    expect(youtube.status).toBe("healthy");
    expect(youtube.details).toContain(`${fsi}2026-10-10T11:00:00Z${pdi}`);
    const telegram = report.services.find(
      (service) => service.id === "telegram_api",
    )!;
    expect(telegram).toMatchObject({
      status: "not_monitored",
      details: "لا توجد عملية مكتملة خلال آخر 7 أيام",
    });
  });

  it("applies every Paddle rule at the 30-day edge", () => {
    const noEvents = build({ billing_webhooks: {} });
    expect(
      noEvents.services.find((service) => service.id === "paddle_billing"),
    ).toMatchObject({
      status: "not_monitored",
      details: "لم يُستقبل أي خطاف ويب بعد",
    });

    const problem = build({
      billing_webhooks: {
        last_received_at: "2026-10-10T11:00:00Z",
        received_24h: 2,
        problems_7d: 1,
      },
    });
    expect(
      problem.services.find((service) => service.id === "paddle_billing")!
        .status,
    ).toBe("degraded");

    const exact30Days = build({
      billing_webhooks: {
        last_received_at: "2026-09-10T12:00:00Z",
        received_24h: 0,
        problems_7d: 0,
      },
    });
    expect(
      exact30Days.services.find((service) => service.id === "paddle_billing")!
        .status,
    ).toBe("healthy");

    const older = build({
      billing_webhooks: {
        last_received_at: "2026-09-10T11:59:59.999Z",
        received_24h: 0,
        problems_7d: 0,
      },
    });
    expect(
      older.services.find((service) => service.id === "paddle_billing")!.status,
    ).toBe("not_monitored");
    expect(
      older.services.find((service) => service.id === "paddle_billing")!
        .details,
    ).toContain("2026-09-10T11:59:59.999Z");
  });

  it("derives summary counts and overall status from record-backed services", () => {
    const report = build({
      platforms: {
        youtube: platform(),
        telegram: platform({
          last_status: "partial",
          last_error_code: "incomplete",
        }),
        x: platform({
          last_status: "failed",
          last_failure_at: "2026-10-10T11:00:00Z",
          last_error_code: "rate_limited",
        }),
        tiktok: platform({ last_status: null }),
      },
      billing_webhooks: {
        last_received_at: "2026-10-10T11:00:00Z",
        problems_7d: 0,
      },
    });
    expect(report.overall_status).toBe("down");
    expect(report.summary).toMatchObject({
      healthy: 3,
      degraded: 1,
      down: 1,
      not_monitored: report.services.length - 5,
    });
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
