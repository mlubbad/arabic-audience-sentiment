/**
 * One row of `admin_workspaces()`: a workspace and the subscription it has,
 * if any. The four subscription fields are null together for a workspace that
 * has never been activated; `period_end` is the instant the row's terms end.
 */
import { z } from "zod";
import { timestamp } from "./primitives";

export const AdminWorkspaceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    created_by: z.string().uuid(),
    plan_key: z.string().nullable(),
    status: z.string().nullable(),
    period_end: timestamp.nullable(),
    provider: z.string().nullable(),
  })
  .strict();

export const AdminWorkspacesSchema = z.array(AdminWorkspaceSchema);

export type AdminWorkspace = z.infer<typeof AdminWorkspaceSchema>;

/** One row of `admin_users()`: a signed-up user, when they were last here,
 *  and how many workspaces they stand in — of which how many they own. The
 *  email is the one personal field this read carries, and the platform-admin
 *  gate in the function is the only reason it may. */
export const AdminUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    created_at: timestamp,
    last_sign_in_at: timestamp.nullable(),
    workspace_count: z.number().int().nonnegative(),
    owner_count: z.number().int().nonnegative(),
  })
  .strict();

export const AdminUsersSchema = z.array(AdminUserSchema);

export type AdminUser = z.infer<typeof AdminUserSchema>;

/** One row of `admin_channels()`: a channel, the workspace it feeds, how much
 *  has been collected through it, and the verdict of its last sync run —
 *  null together when the channel has never run one. */
export const AdminChannelSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    workspace_name: z.string(),
    external_channel_id: z.string(),
    handle: z.string().nullable(),
    title: z.string().nullable(),
    status: z.string(),
    video_count: z.number().int().nonnegative(),
    comment_count: z.number().int().nonnegative(),
    last_sync_at: timestamp.nullable(),
    last_sync_status: z.string().nullable(),
    last_sync_error: z.string().nullable(),
  })
  .strict();

export const AdminChannelsSchema = z.array(AdminChannelSchema);

export type AdminChannel = z.infer<typeof AdminChannelSchema>;

/** A failed or partial sync run inside `admin_ops()`'s list. */
export const AdminFailedRunSchema = z
  .object({
    workspace_id: z.string().uuid(),
    workspace_name: z.string(),
    channel_id: z.string().uuid(),
    handle: z.string().nullable(),
    mode: z.string(),
    source: z.string(),
    started_at: timestamp,
    ended_at: timestamp.nullable(),
    status: z.string(),
    error_code: z.string().nullable(),
  })
  .strict();

export const AdminFailedRunsSchema = z.array(AdminFailedRunSchema);

export type AdminFailedRun = z.infer<typeof AdminFailedRunSchema>;

/** The object `admin_ops()` returns: the overview numbers the cards read,
 *  plus the recent failed runs. `worker_fresh` is the three-minute rule the
 *  connection panel states; `worker_last_seen` is null when no worker has
 *  ever asked. */
export const AdminOpsSchema = z
  .object({
    workspaces: z.number().int().nonnegative(),
    channels: z.number().int().nonnegative(),
    comments_7d: z.number().int().nonnegative(),
    worker_fresh: z.boolean(),
    worker_last_seen: timestamp.nullable(),
    jobs_open: z.number().int().nonnegative(),
    sync_runs_7d: z.number().int().nonnegative(),
    sync_failed_7d: z.number().int().nonnegative(),
    failed_runs: AdminFailedRunsSchema,
  })
  .strict();

export type AdminOps = z.infer<typeof AdminOpsSchema>;

/** One row of `admin_audit()`: what was done, by whom, to what, and when. */
export const AdminAuditEventSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    workspace_name: z.string(),
    actor_id: z.string().uuid().nullable(),
    actor_email: z.string().email().nullable(),
    action: z.string(),
    target_type: z.string(),
    target_id: z.string().nullable(),
    created_at: timestamp,
  })
  .strict();

export const AdminAuditEventsSchema = z.array(AdminAuditEventSchema);

export type AdminAuditEvent = z.infer<typeof AdminAuditEventSchema>;
