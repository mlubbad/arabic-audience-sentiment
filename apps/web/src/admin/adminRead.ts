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
  type ServicesHealthReport,
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

export async function readAdminServicesHealth(options?: {
  isDemo?: boolean;
}): Promise<ServicesHealthReport> {
  if (options?.isDemo || !supabase) {
    return getDemoServicesHealth();
  }

  const t0 = performance.now();
  const { data, error } = await supabase.rpc("admin_services_health");
  const t1 = performance.now();
  const dbLatencyMs = Math.round(t1 - t0);

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("services_health_unavailable");
  }

  const baseDemo = getDemoServicesHealth();
  const db = (
    data as { database?: { size_mb?: number; active_connections?: number } }
  ).database;
  const worker = (
    data as { worker?: { fresh?: boolean; jobs_queued?: number } }
  ).worker;
  const sync24h = (data as { sync_24h?: { youtube_runs?: number } }).sync_24h;

  baseDemo.checked_at =
    (data as { checked_at?: string }).checked_at || new Date().toISOString();

  // In live mode, mark services not covered by the live monitoring RPC as not_monitored
  const reportedServiceIds = new Set<string>();

  // Update postgres row
  const pg = baseDemo.services.find((s) => s.id === "supabase_postgres");
  if (pg) {
    reportedServiceIds.add("supabase_postgres");
    pg.latency_ms = dbLatencyMs;
    if (db?.size_mb != null) pg.quota_used = db.size_mb;
    if (db?.active_connections != null) {
      pg.details = `الاتصالات النشطة: ${db.active_connections}/100 · مساحة التخزين: ${db.size_mb || 0} MB · سياسات RLS مفعّلة`;
    }
  }

  // Update worker row
  const w = baseDemo.services.find((s) => s.id === "python_worker");
  if (w && worker) {
    reportedServiceIds.add("python_worker");
    w.status = worker.fresh ? "healthy" : "degraded";
    w.quota_used = worker.jobs_queued ?? 0;
  }

  // Update youtube row
  const yt = baseDemo.services.find((s) => s.id === "youtube_api");
  if (yt && sync24h?.youtube_runs != null) {
    reportedServiceIds.add("youtube_api");
    yt.quota_used = Math.min(10000, sync24h.youtube_runs * 100);
  }

  // Any service NOT covered by the live monitoring query is honestly not_monitored
  for (const s of baseDemo.services) {
    if (!reportedServiceIds.has(s.id)) {
      s.status = "not_monitored";
      s.latency_ms = null;
    }
  }

  baseDemo.summary = {
    total: baseDemo.services.length,
    healthy: baseDemo.services.filter((s) => s.status === "healthy").length,
    degraded: baseDemo.services.filter((s) => s.status === "degraded").length,
    down: baseDemo.services.filter((s) => s.status === "down").length,
    unconfigured: baseDemo.services.filter((s) => s.status === "unconfigured")
      .length,
    not_monitored: baseDemo.services.filter((s) => s.status === "not_monitored")
      .length,
    avg_latency_ms: (() => {
      const monitored = baseDemo.services.filter(
        (s) => s.latency_ms !== null && s.status !== "not_monitored",
      );
      if (monitored.length === 0) return null;
      return Math.round(
        monitored.reduce((acc, s) => acc + (s.latency_ms ?? 0), 0) /
          monitored.length,
      );
    })(),
  };

  return ServicesHealthReportSchema.parse(baseDemo);
}
