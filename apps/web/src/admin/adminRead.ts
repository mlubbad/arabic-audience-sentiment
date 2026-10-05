/**
 * The four reads phase one of the admin roadmap adds: users, channels, the
 * operations overview, and the audit trail. Every one is a single RPC whose
 * server gate is `is_platform_admin()`; the zod contract is checked where
 * the row is read, so a schema drift refuses loudly here instead of
 * rendering quietly wrong there.
 *
 * Thrown as they came, like `readWorkspaces` in `AdminPage.tsx`: the
 * sentence is chosen where the error is shown, from the code alone — never
 * from the text, which can carry the request URL.
 */
import {
  AdminAuditEventsSchema,
  AdminChannelsSchema,
  AdminOpsSchema,
  AdminUsersSchema,
  ServicesHealthReportSchema,
  type AdminAuditEvent,
  type AdminChannel,
  type AdminOps,
  type AdminUser,
  type ServiceHealthItem,
  type ServicesHealthReport,
  type ServiceStatus,
} from "@sentiment/contracts";
import { supabase } from "../supabase";
import { getDemoServicesHealth } from "./adminServicesDemo";

export async function readAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase!.rpc("admin_users");
  if (error) throw error;
  return AdminUsersSchema.parse(data);
}

export async function readAdminChannels(): Promise<AdminChannel[]> {
  const { data, error } = await supabase!.rpc("admin_channels");
  if (error) throw error;
  return AdminChannelsSchema.parse(data);
}

export async function readAdminOps(): Promise<AdminOps> {
  const { data, error } = await supabase!.rpc("admin_ops");
  if (error) throw error;
  return AdminOpsSchema.parse(data);
}

/** How much of the trail to ask for. The database accepts one to five
 *  hundred; the page offers the three useful rungs. */
export const AUDIT_LIMITS = [100, 300, 500] as const;
export type AuditLimit = (typeof AUDIT_LIMITS)[number];

export async function readAdminAudit(
  limit: AuditLimit = 100,
): Promise<AdminAuditEvent[]> {
  const { data, error } = await supabase!.rpc("admin_audit", {
    p_limit: limit,
  });
  if (error) throw error;
  return AdminAuditEventsSchema.parse(data);
}

export async function updatePlanPublicChannels(
  planKey: string,
  allowed: boolean,
): Promise<void> {
  const { error } = await supabase!.rpc("set_plan_public_channels", {
    p_plan_key: planKey,
    p_allowed: allowed,
  });
  if (error) throw error;
}

export async function updatePlanLimits(
  planKey: string,
  limits: Record<string, unknown>,
): Promise<{ ok: boolean; plan: unknown }> {
  const { data, error } = await supabase!.rpc("update_plan_limits", {
    p_plan_key: planKey,
    p_limits: limits,
  });
  if (error) throw error;
  return data as { ok: boolean; plan: unknown };
}

/** What `admin_services_health()` returns today: telemetry for the database,
 *  the worker and the last day's sync runs. Nothing else is measured. */
type ServicesHealthRpc = {
  checked_at?: string;
  database?: { size_mb?: number | null; active_connections?: number | null };
  worker?: { fresh?: boolean | null; jobs_queued?: number | null };
};

const STATUS_RANK: Record<ServiceStatus, number> = {
  down: 3,
  degraded: 2,
  healthy: 1,
  unconfigured: 0,
  not_monitored: 0,
};

/**
 * The live report, built only from what the server measured. The demo module
 * supplies each service's name, category and endpoint (descriptors, not
 * telemetry); every reading starts unknown and only the database and the
 * worker are filled in. A service with no reading is `not_monitored`, never
 * the demo's "healthy".
 */
export function buildLiveServicesReport(
  data: ServicesHealthRpc,
  dbLatencyMs: number,
  now: Date = new Date(),
): ServicesHealthReport {
  const checkedAt = data.checked_at ?? now.toISOString();
  const services: ServiceHealthItem[] = getDemoServicesHealth().services.map(
    (s) => ({
      ...s,
      status: "not_monitored",
      latency_ms: null,
      quota_used: null,
      details: "",
      last_checked_at: checkedAt,
      error_code: null,
      remediation: null,
    }),
  );

  const pg = services.find((s) => s.id === "supabase_postgres");
  if (pg) {
    // The RPC answered, so the database is reachable; how fast is measured.
    pg.status = "healthy";
    pg.latency_ms = dbLatencyMs;
    pg.quota_used = data.database?.size_mb ?? null;
    const parts: string[] = [];
    if (data.database?.active_connections != null)
      parts.push(`الاتصالات النشطة: ${data.database.active_connections}`);
    if (data.database?.size_mb != null)
      parts.push(`مساحة التخزين: ${data.database.size_mb} MB`);
    pg.details = parts.join(" · ");
  }

  const worker = services.find((s) => s.id === "python_worker");
  if (worker && data.worker?.fresh != null) {
    worker.status = data.worker.fresh ? "healthy" : "degraded";
    worker.quota_used = data.worker.jobs_queued ?? null;
  }

  const count = (status: ServiceStatus) =>
    services.filter((s) => s.status === status).length;
  const latencies = services
    .map((s) => s.latency_ms)
    .filter((v): v is number => v != null);
  const monitored = services.filter(
    (s) => s.status !== "not_monitored" && s.status !== "unconfigured",
  );
  const overall: ServiceStatus = monitored.length
    ? monitored.reduce<ServiceStatus>(
        (worst, s) =>
          STATUS_RANK[s.status] > STATUS_RANK[worst] ? s.status : worst,
        "healthy",
      )
    : "not_monitored";

  return ServicesHealthReportSchema.parse({
    overall_status: overall,
    checked_at: checkedAt,
    summary: {
      total: services.length,
      healthy: count("healthy"),
      degraded: count("degraded"),
      down: count("down"),
      unconfigured: count("unconfigured"),
      not_monitored: count("not_monitored"),
      avg_latency_ms: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
    },
    services,
  });
}

/**
 * Demo data only when the page asked for it (`?demo`). In live mode a failed
 * read is thrown as it came, so the page shows its error state; it never
 * falls back to the demo report, which would read "healthy" for services
 * nobody measured.
 */
export async function readAdminServicesHealth(options?: {
  isDemo?: boolean;
}): Promise<ServicesHealthReport> {
  if (options?.isDemo || !supabase) {
    return getDemoServicesHealth();
  }
  const t0 = performance.now();
  const { data, error } = await supabase.rpc("admin_services_health");
  const dbLatencyMs = Math.round(performance.now() - t0);
  if (error) throw error;
  if (!data) throw new Error("services_health_unavailable");
  return buildLiveServicesReport(data as ServicesHealthRpc, dbLatencyMs);
}
