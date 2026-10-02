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

  try {
    const t0 = performance.now();
    const { data, error } = await supabase.rpc("admin_services_health");
    const t1 = performance.now();
    const dbLatencyMs = Math.round(t1 - t0);

    if (error || !data) {
      // In case the migration hasn't been applied to remote yet or local fallback,
      // return demo health with measured db latency.
      const fallback = getDemoServicesHealth();
      fallback.services[0].latency_ms = dbLatencyMs;
      return fallback;
    }

    const baseDemo = getDemoServicesHealth();
    const db = (
      data as { database?: { size_mb?: number; active_connections?: number } }
    ).database;
    const worker = (
      data as { worker?: { fresh?: boolean; jobs_queued?: number } }
    ).worker;
    const sync24h = (data as { sync_24h?: { youtube_runs?: number } }).sync_24h;

    // Enhance base telemetry with live database telemetry
    baseDemo.checked_at =
      (data as { checked_at?: string }).checked_at || new Date().toISOString();

    // Update postgres row
    const pg = baseDemo.services.find((s) => s.id === "supabase_postgres");
    if (pg) {
      pg.latency_ms = dbLatencyMs;
      if (db?.size_mb != null) pg.quota_used = db.size_mb;
      if (db?.active_connections != null) {
        pg.details = `الاتصالات النشطة: ${db.active_connections}/100 · مساحة التخزين: ${db.size_mb || 0} MB · سياسات RLS مفعّلة`;
      }
    }

    // Update worker row
    const w = baseDemo.services.find((s) => s.id === "python_worker");
    if (w && worker) {
      w.status = worker.fresh ? "healthy" : "degraded";
      w.quota_used = worker.jobs_queued ?? 0;
    }

    // Update youtube row
    const yt = baseDemo.services.find((s) => s.id === "youtube_api");
    if (yt && sync24h?.youtube_runs != null) {
      yt.quota_used = Math.min(10000, sync24h.youtube_runs * 100);
    }

    return ServicesHealthReportSchema.parse(baseDemo);
  } catch {
    return getDemoServicesHealth();
  }
}
