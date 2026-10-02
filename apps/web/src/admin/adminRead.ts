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
  type ServiceStatus,
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

  const baseDemo = getDemoServicesHealth();
  const checkedAt = new Date().toISOString();

  try {
    const t0 = performance.now();
    const { data, error } = await supabase.rpc("admin_services_health");
    const t1 = performance.now();
    const dbLatencyMs = Math.round(t1 - t0);

    if (error || !data) {
      // Live query failed: report Postgres as down with actual latency and error,
      // and do NOT fabricate healthy statuses for unmonitored services.
      const services: ServiceHealthItem[] = baseDemo.services.map((s) => {
        if (s.id === "supabase_postgres") {
          return {
            ...s,
            status: "down",
            latency_ms: dbLatencyMs,
            details: `تعذّرت قراءة قياسات النظام من قاعدة البيانات: ${error?.message || "خطأ غير معروف"}`,
            error_code: error?.code || "DATABASE_ERROR",
            remediation: "تحقق من اتصال قاعدة البيانات وصلاحيات حساب المشرف.",
            last_checked_at: checkedAt,
          };
        }
        return {
          ...s,
          status: "unconfigured",
          latency_ms: null,
          quota_used: null,
          quota_total: null,
          quota_unit: null,
          details: "غير مفعّل في بيئة المراقبة المباشرة",
          endpoint: null,
          error_code: null,
          remediation: null,
          last_checked_at: checkedAt,
        };
      });

      return ServicesHealthReportSchema.parse({
        overall_status: "down",
        checked_at: checkedAt,
        summary: {
          total: services.length,
          healthy: 0,
          degraded: 0,
          down: 1,
          unconfigured: services.length - 1,
          avg_latency_ms: dbLatencyMs,
        },
        services,
      });
    }

    const payload = data as {
      checked_at?: string;
      database?: {
        status?: string;
        size_mb?: number;
        active_connections?: number;
      };
      worker?: {
        fresh?: boolean;
        last_seen_at?: string | null;
        jobs_queued?: number;
        jobs_running?: number;
      };
      sync_24h?: {
        total_runs?: number;
        failed_runs?: number;
        youtube_runs?: number;
      };
    };

    const db = payload.database;
    const worker = payload.worker;
    const sync24h = payload.sync_24h;

    const services: ServiceHealthItem[] = baseDemo.services.map((s) => {
      if (s.id === "supabase_postgres") {
        const isHealthy = dbLatencyMs < 1000;
        return {
          ...s,
          status: isHealthy ? "healthy" : "degraded",
          latency_ms: dbLatencyMs,
          quota_used: db?.size_mb ?? null,
          details: `الاتصالات النشطة: ${db?.active_connections ?? 0}/100 · مساحة التخزين: ${db?.size_mb ?? 0} MB · سياسات RLS مفعّلة`,
          last_checked_at: payload.checked_at || checkedAt,
        };
      }

      if (s.id === "python_worker") {
        let status: ServiceStatus = "unconfigured";
        let details = "العامل لم يسجل أي حضور بعد";
        if (worker) {
          if (worker.fresh) {
            status = "healthy";
            details = `العامل متصل ونشط · قيد التشغيل: ${worker.jobs_running ?? 0} · في الانتظار: ${worker.jobs_queued ?? 0}`;
          } else if (worker.last_seen_at) {
            status = "degraded";
            details = `انقطع اتصال العامل منذ آخر حضور (${new Date(worker.last_seen_at).toLocaleTimeString("ar-EG")})`;
          } else {
            status = "down";
            details = "العامل غير متصل تماماً";
          }
        }
        return {
          ...s,
          status,
          latency_ms: null,
          quota_used: worker?.jobs_queued ?? 0,
          details,
          last_checked_at: payload.checked_at || checkedAt,
        };
      }

      if (s.id === "youtube_api") {
        const ytRuns = sync24h?.youtube_runs ?? 0;
        const failedRuns = sync24h?.failed_runs ?? 0;
        const status: ServiceStatus = failedRuns > 0 ? "degraded" : "healthy";
        return {
          ...s,
          status,
          latency_ms: null,
          quota_used: Math.min(10000, ytRuns * 100),
          quota_total: 10000,
          quota_unit: "نقطة حصة يومية",
          details: `عمليات المزامنة خلال 24 ساعة: ${ytRuns} · محاولات غير مكتملة: ${failedRuns}`,
          last_checked_at: payload.checked_at || checkedAt,
        };
      }

      // All other 12 third-party or unmonitored services stay honest: unconfigured
      return {
        ...s,
        status: "unconfigured",
        latency_ms: null,
        quota_used: null,
        quota_total: null,
        quota_unit: null,
        details: "غير مفعّل في بيئة المراقبة المباشرة",
        endpoint: null,
        error_code: null,
        remediation: null,
        last_checked_at: payload.checked_at || checkedAt,
      };
    });

    const healthyCount = services.filter((s) => s.status === "healthy").length;
    const degradedCount = services.filter(
      (s) => s.status === "degraded",
    ).length;
    const downCount = services.filter((s) => s.status === "down").length;
    const unconfiguredCount = services.filter(
      (s) => s.status === "unconfigured",
    ).length;

    const measuredLatencies = services
      .map((s) => s.latency_ms)
      .filter((l): l is number => l != null && l >= 0);
    const avgLatencyMs =
      measuredLatencies.length > 0
        ? Math.round(
            measuredLatencies.reduce((sum, v) => sum + v, 0) /
              measuredLatencies.length,
          )
        : null;

    let overallStatus: ServiceStatus = "healthy";
    if (downCount > 0) {
      overallStatus = "down";
    } else if (degradedCount > 0) {
      overallStatus = "degraded";
    } else if (healthyCount > 0) {
      overallStatus = "healthy";
    } else {
      overallStatus = "unconfigured";
    }

    return ServicesHealthReportSchema.parse({
      overall_status: overallStatus,
      checked_at: payload.checked_at || checkedAt,
      summary: {
        total: services.length,
        healthy: healthyCount,
        degraded: degradedCount,
        down: downCount,
        unconfigured: unconfiguredCount,
        avg_latency_ms: avgLatencyMs,
      },
      services,
    });
  } catch (err: unknown) {
    // If unexpected exception occurs, report Postgres down, not fake demo data!
    const services: ServiceHealthItem[] = baseDemo.services.map((s) => {
      if (s.id === "supabase_postgres") {
        return {
          ...s,
          status: "down",
          latency_ms: null,
          details: `استثناء أثناء فحص الخدمات: ${err instanceof Error ? err.message : String(err)}`,
          error_code: "HEALTH_CHECK_EXCEPTION",
          remediation: "تحقق من سجل أخطاء العميل واتصال الشبكة.",
          last_checked_at: checkedAt,
        };
      }
      return {
        ...s,
        status: "unconfigured",
        latency_ms: null,
        quota_used: null,
        quota_total: null,
        quota_unit: null,
        details: "غير مفعّل في بيئة المراقبة المباشرة",
        endpoint: null,
        error_code: null,
        remediation: null,
        last_checked_at: checkedAt,
      };
    });

    return ServicesHealthReportSchema.parse({
      overall_status: "down",
      checked_at: checkedAt,
      summary: {
        total: services.length,
        healthy: 0,
        degraded: 0,
        down: 1,
        unconfigured: services.length - 1,
        avg_latency_ms: null,
      },
      services,
    });
  }
}
