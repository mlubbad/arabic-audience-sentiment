import { z } from "zod";
import { timestamp } from "./primitives";

export const WorkspaceMemberRoleSchema = z.enum([
  "workspace_owner",
  "analyst",
  "viewer",
]);
export type WorkspaceMemberRole = z.infer<typeof WorkspaceMemberRoleSchema>;

export const WorkspaceAccountSchema = z
  .object({
    user_id: z.string().uuid(),
    email: z.string(),
    role: WorkspaceMemberRoleSchema,
    is_owner: z.boolean(),
    added_at: timestamp,
  })
  .strict();
export type WorkspaceAccount = z.infer<typeof WorkspaceAccountSchema>;

export const WorkspaceAccountsResponseSchema = z
  .object({
    workspace_id: z.string().uuid(),
    members_limit: z.number().int().positive().nullable(),
    total_members: z.number().int().nonnegative(),
    accounts: z.array(WorkspaceAccountSchema),
  })
  .strict();
export type WorkspaceAccountsResponse = z.infer<
  typeof WorkspaceAccountsResponseSchema
>;

export const ShareWorkspaceInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    account_email: z.string().email(),
    account_role: z.enum(["analyst", "viewer"]),
  })
  .strict();
export type ShareWorkspaceInput = z.infer<typeof ShareWorkspaceInputSchema>;
