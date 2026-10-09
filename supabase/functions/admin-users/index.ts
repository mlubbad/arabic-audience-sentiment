/**
 * The account file's actions that need the auth admin API: a reset link the
 * owner hands over, suspension and its lifting, a manual email confirmation,
 * and an email change.
 *
 * Two clients. The caller's own (the anon key plus their `authorization`
 * header) asks the database who they are and records what was done:
 * `admin_user_target` answers only a platform admin. The service client is
 * used only after that answer, and only for `auth.admin`.
 *
 * Deployed WITH the gateway's JWT check: the caller is the signed-in owner.
 *
 * The decision lives in `_shared/admin-users.ts` and is tested there without a
 * project; this file is only the side effects it needs.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  adminUserAction,
  type AdminUsersDb,
  type AuthAdmin,
  type Target,
} from "../_shared/admin-users.ts";
import { corsHeaders, parseOrigins, preflight } from "../_shared/cors.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

Deno.serve(async (request) => {
  const pre = preflight(request, allowed);
  if (pre) return pre;

  const json = (code: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: {
        "content-type": "application/json",
        ...corsHeaders(request, allowed),
      },
    });

  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });
  const authorization = request.headers.get("authorization");
  if (!authorization) return json(401, { code: "unauthenticated" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }

  const caller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const db: AdminUsersDb = {
    target: async (userId) => {
      const { data, error } = await caller.rpc("admin_user_target", {
        p_user: userId,
      });
      if (error) throw new Error(error.message || "unavailable");
      return data as Target;
    },
    record: async (userId, action) => {
      const { error } = await caller.rpc("admin_record_user_action", {
        p_user: userId,
        p_action: action,
      });
      if (error) throw new Error("not_recorded");
    },
  };

  const auth: AuthAdmin = {
    recoveryLink: async (email, redirectTo) => {
      const { data, error } = await service.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (error) throw error;
      const link = data.properties?.action_link;
      if (typeof link !== "string") throw new Error("no_link");
      return link;
    },
    update: async (userId, attributes) => {
      const { error } = await service.auth.admin.updateUserById(
        userId,
        attributes,
      );
      if (error) throw error;
    },
  };

  const { status, body: out } = await adminUserAction(
    body,
    request.headers.get("origin"),
    allowed,
    db,
    auth,
  );
  return json(status, out);
});
