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
  AdminChannelsConsoleSchema,
  AdminChannelsSchema,
  AdminConsoleOverviewSchema,
  AdminOpsSchema,
  AdminUserDetailSchema,
  AdminUsersSchema,
  ServicesHealthReportSchema,
  type AdminAuditEvent,
  type AdminChannel,
  type AdminConsoleChannel,
  type AdminConsoleOverview,
  type AdminOps,
  type AdminUser,
  type AdminUserDetail,
  type ServiceHealthItem,
  type ServicesHealthReport,
  type ServiceStatus,
} from "@sentiment/contracts";
import { DashboardRpcError } from "../data";
import { supabase } from "../supabase";
import { getDemoServicesHealth } from "./adminServicesDemo";

/** A failed admin RPC as the page can name it: `live_unavailable` with the
 *  database's own code (`read:live_unavailable:PGRST202`), never the raw error,
 *  which `failureCode` can only call `unexpected`. The services page showed
 *  `read:unexpected:Error` for a function missing from production
 *  (2026-10-05). */
function rpcFailure(error: {
  code?: string;
  details?: unknown;
  hint?: string;
}) {
  return new DashboardRpcError("live_unavailable", {
    code: error.code,
    details: error.details,
    hint: error.hint,
    cause: error,
  });
}

export async function readAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase!.rpc("admin_users");
  if (error) throw rpcFailure(error);
  return AdminUsersSchema.parse(data);
}

/** One person for the account file. */
export async function readAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail> {
  const { data, error } = await supabase!.rpc("admin_user_detail", {
    p_user: userId,
  });
  if (error) throw rpcFailure(error);
  return AdminUserDetailSchema.parse(data);
}

export type AdminProfileInput = {
  display_name: string;
  organization: string;
  phone: string;
  admin_note: string;
};

/** The account file's writes are thrown as they came: the page reads the
 *  database's own refusal (`profile_too_long`) from the message, which for a
 *  raised exception is the exception's text and nothing else. */
export async function saveAdminUserProfile(
  userId: string,
  p: AdminProfileInput,
): Promise<void> {
  const { error } = await supabase!.rpc("admin_update_user_profile", {
    p_user: userId,
    p_display_name: p.display_name,
    p_organization: p.organization,
    p_phone: p.phone,
    p_admin_note: p.admin_note,
  });
  if (error) throw error;
}

/** A password reset link to the person's own inbox, through the same
 *  `/recover` door their "forgot your password?" uses, then a row in the
 *  trail saying the owner sent it. The link lands on `/reset-password`. */
export async function sendPasswordReset(
  userId: string,
  email: string,
): Promise<void> {
  const db = supabase!;
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
  const recorded = await db.rpc("admin_record_user_action", {
    p_user: userId,
    p_action: "password_reset_sent",
  });
  if (recorded.error) throw recorded.error;
}

export type AdminUserActionName =
  "recovery_link" | "suspend" | "unsuspend" | "confirm_email" | "change_email";

/** What the account file can say about an `admin-users` answer. */
export type AdminUserActionCode =
  | "forbidden"
  | "user_not_found"
  | "cannot_suspend_admin"
  | "no_email"
  | "email_taken"
  | "invalid_request"
  | "not_deployed"
  | "unavailable";

export class AdminUserActionError extends Error {
  constructor(readonly code: AdminUserActionCode) {
    super(code);
  }
}

const KNOWN: readonly AdminUserActionCode[] = [
  "forbidden",
  "user_not_found",
  "cannot_suspend_admin",
  "no_email",
  "email_taken",
  "invalid_request",
];

/** One action of the `admin-users` Edge Function, with the caller's own
 *  token: the function asks the database whether they are an admin. A 404
 *  that is not the function's own `user_not_found` is the gateway saying the
 *  function is not deployed yet — the owner deploys it, so the page says so. */
export async function adminUserAction(
  action: AdminUserActionName,
  userId: string,
  email?: string,
): Promise<{ recorded: boolean; link?: string }> {
  const { data } = await supabase!.auth.getSession();
  const session = data.session;
  if (!session) throw new AdminUserActionError("forbidden");
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, user_id: userId, email }),
      },
    );
  } catch {
    throw new AdminUserActionError("unavailable");
  }
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    recorded?: boolean;
    link?: string;
  };
  if (response.ok)
    return { recorded: body.recorded !== false, link: body.link };
  const known = KNOWN.find((c) => c === body.code);
  if (known) throw new AdminUserActionError(known);
  if (response.status === 404) throw new AdminUserActionError("not_deployed");
  throw new AdminUserActionError("unavailable");
}

/** A member's role in one workspace, through the function the workspace's
 *  own share dialog uses: analyst or viewer, never the owner's seat. */
export async function setAdminMemberRole(
  workspaceId: string,
  userId: string,
  role: "analyst" | "viewer",
): Promise<void> {
  const { error } = await supabase!.rpc("update_workspace_account_role", {
    w: workspaceId,
    target_user_id: userId,
    new_role: role,
  });
  if (error) throw error;
}

/** The owner console's home: the whole platform in one read. */
export async function readAdminConsoleOverview(): Promise<AdminConsoleOverview> {
  const { data, error } = await supabase!.rpc("admin_console_overview");
  if (error) throw rpcFailure(error);
  return AdminConsoleOverviewSchema.parse(data);
}

/** The owner console's channels page: every channel with its state. */
export async function readAdminChannelsConsole(): Promise<
  AdminConsoleChannel[]
> {
  const { data, error } = await supabase!.rpc("admin_channels_console");
  if (error) throw rpcFailure(error);
  return AdminChannelsConsoleSchema.parse(data);
}

export async function readAdminChannels(): Promise<AdminChannel[]> {
  const { data, error } = await supabase!.rpc("admin_channels");
  if (error) throw rpcFailure(error);
  return AdminChannelsSchema.parse(data);
}

export async function readAdminOps(): Promise<AdminOps> {
  const { data, error } = await supabase!.rpc("admin_ops");
  if (error) throw rpcFailure(error);
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
  if (error) throw rpcFailure(error);
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
  if (error) throw rpcFailure(error);
}

export async function updatePlanLimits(
  planKey: string,
  limits: Record<string, unknown>,
): Promise<{ ok: boolean; plan: unknown }> {
  const { data, error } = await supabase!.rpc("update_plan_limits", {
    p_plan_key: planKey,
    p_limits: limits,
  });
  if (error) throw rpcFailure(error);
  return data as { ok: boolean; plan: unknown };
}

type PlatformHealthRpc = {
  last_status?: string | null;
  last_finished_at?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_error_code?: string | null;
  runs_24h?: number | null;
  failures_24h?: number | null;
  consecutive_failures?: number | null;
};

type ServicesHealthRpc = {
  checked_at?: string;
  database?: { size_mb?: number | null; active_connections?: number | null };
  worker?: { fresh?: boolean | null; jobs_queued?: number | null };
  platforms?: Partial<
    Record<"youtube" | "telegram" | "x" | "tiktok", PlatformHealthRpc>
  >;
  billing_webhooks?: {
    last_received_at?: string | null;
    last_outcome?: string | null;
    received_24h?: number | null;
    problems_7d?: number | null;
  };
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
      // No live limit is known for any service; the demo's 1,024 MB and 100
      // jobs were drawn as real allowances on the live page (2026-10-06).
      quota_total: null,
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

  const isolate = (value: string) =>
    `${String.fromCodePoint(0x2068)}${value}${String.fromCodePoint(0x2069)}`;
  const formatTimestamp = (value: string) =>
    new Date(value).toISOString().replace(".000Z", "Z");
  const platformServices = {
    youtube: "youtube_api",
    telegram: "telegram_api",
    x: "x_twitter_api",
    tiktok: "tiktok_api",
  } as const;
  const quotaOrRateCode = /quota|rate_limit|rate_limited|insufficient_quota/i;

  for (const [platform, serviceId] of Object.entries(platformServices)) {
    const health = data.platforms?.[platform as keyof typeof platformServices];
    const service = services.find((s) => s.id === serviceId);
    if (!health || !service) continue;

    if (health.last_status == null) {
      service.details = "لا توجد عملية مكتملة خلال آخر 7 أيام";
      continue;
    }

    const latestRunFailed = ["failed", "blocked"].includes(health.last_status);
    const latestHasQuotaError =
      latestRunFailed &&
      health.last_error_code != null &&
      quotaOrRateCode.test(health.last_error_code);
    const lastSuccessIsStale =
      health.last_success_at == null ||
      Date.parse(health.last_success_at) < now.getTime() - 48 * 60 * 60 * 1000;

    if (latestHasQuotaError || (health.consecutive_failures ?? 0) >= 3) {
      service.status = "down";
    } else if (
      ["failed", "blocked", "partial"].includes(health.last_status) ||
      lastSuccessIsStale
    ) {
      service.status = "degraded";
    } else {
      service.status = "healthy";
    }

    if (service.status === "down" || service.status === "degraded")
      service.error_code = health.last_error_code ?? null;
    const lastSuccess = health.last_success_at
      ? isolate(formatTimestamp(health.last_success_at))
      : "لا يوجد";
    service.details =
      `آخر نجاح: ${lastSuccess}` +
      ` · التشغيلات خلال 24 ساعة: ${health.runs_24h ?? 0}` +
      ` · الإخفاقات: ${health.failures_24h ?? 0}`;
  }

  const paddle = services.find((s) => s.id === "paddle_billing");
  if (paddle && data.billing_webhooks) {
    const billing = data.billing_webhooks;
    if (billing.last_received_at == null) {
      paddle.details = "لم يُستقبل أي خطاف ويب بعد";
    } else if ((billing.problems_7d ?? 0) > 0) {
      paddle.status = "degraded";
      paddle.details =
        `المستلم خلال 24 ساعة: ${billing.received_24h ?? 0}` +
        ` · المشكلات خلال 7 أيام: ${billing.problems_7d}`;
    } else if (
      Date.parse(billing.last_received_at) >=
      now.getTime() - 30 * 24 * 60 * 60 * 1000
    ) {
      paddle.status = "healthy";
      paddle.details = `المستلم خلال 24 ساعة: ${billing.received_24h ?? 0}`;
    } else {
      paddle.details =
        `آخر خطاف ويب مستلم: ` +
        isolate(formatTimestamp(billing.last_received_at));
    }
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
  if (error) throw rpcFailure(error);
  if (!data) throw new DashboardRpcError("live_unavailable");
  return buildLiveServicesReport(data as ServicesHealthRpc, dbLatencyMs);
}
