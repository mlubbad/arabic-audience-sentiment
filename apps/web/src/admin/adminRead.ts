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
  type AdminAuditEvent,
  type AdminChannel,
  type AdminOps,
  type AdminUser,
} from "@sentiment/contracts";
import { supabase } from "../supabase";

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
