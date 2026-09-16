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
