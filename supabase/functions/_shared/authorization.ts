export type Role = "workspace_owner" | "analyst" | "viewer";
export interface IdentityStore {
  /** Production adapter must call Supabase Auth getUser(token), never just decode a JWT. */
  getUser(token: string): Promise<{ id: string } | null>;
  getRole(userId: string, workspaceId: string): Promise<Role | null>;
}
export async function authorize(
  store: IdentityStore,
  authorization: string | null,
  workspaceId: string,
  roles: Role[],
) {
  const token = /^Bearer ([^\s]+)$/.exec(authorization ?? "")?.[1];
  const user = token ? await store.getUser(token) : null;
  if (!user) throw { code: "unauthenticated", retryable: false };
  const role = await store.getRole(user.id, workspaceId);
  if (!role || !roles.includes(role))
    throw { code: "forbidden", retryable: false };
  return { user_id: user.id, workspace_id: workspaceId, role };
}
