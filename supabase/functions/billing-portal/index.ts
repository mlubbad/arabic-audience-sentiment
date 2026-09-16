/**
 * Opens Paddle's hosted customer portal for the signed-in owner of a
 * workspace. Runs as the caller, not as the service: the anon key plus the
 * caller's own `authorization` header (the pattern `oauth-start` uses), so
 * `billing_customer_ref` (20260917051000) — `security definer` SQL that
 * requires `workspace_owner` on the workspace's billing root — is the thing
 * that decides whether this caller may see a Paddle customer id, not
 * anything here. A `workspace_id` in the body is never trusted on its own.
 *
 * Deployed WITH the gateway's JWT check, unlike `paddle-webhook`: the caller
 * here is a signed-in user with a Supabase token, not Paddle with an HMAC.
 *
 * The pure decision — a URL, or the one refusal to make — lives in
 * `_shared/billing-portal.ts` and is tested there without a project. This
 * file is only the two side effects that decision needs: the RPC call and
 * the call to Paddle's API.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  portalUrlFor,
  type PortalDb,
  type PortalPaddle,
} from "../_shared/billing-portal.ts";
import { corsHeaders, parseOrigins, preflight } from "../_shared/cors.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

// Sandbox by design unless explicitly told otherwise — the same default
// `scripts/paddle-sync-lib.mjs` and `apps/web/src/paddle.ts` use, so an unset
// or misspelled PADDLE_ENV never lands a real card against production.
const paddleBase = () =>
  env("PADDLE_ENV") === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

Deno.serve(async (request) => {
  // The browser asks before it sends; answering this is the difference
  // between a working button and a network error with nothing behind it.
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
  const auth = request.headers.get("authorization");
  if (!auth) return json(401, { code: "unauthenticated" });

  let body: { workspace_id?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (!body.workspace_id || typeof body.workspace_id !== "string")
    return json(400, { code: "invalid_request" });

  // An unset key is not a key anyone could call Paddle with: refuse before
  // touching the database or Paddle, the same misconfiguration answer
  // paddle-webhook gives for its own secret.
  const apiKey = env("PADDLE_API_KEY");
  if (!apiKey) return json(500, { code: "not_configured" });

  // The caller's own token, so the RPC's ownership check applies to them —
  // never to a workspace this function decided on their behalf.
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });

  const db: PortalDb = {
    customerRefFor: async (w) => {
      const { data, error } = await client.rpc("billing_customer_ref", { w });
      if (error) throw new Error(error.message || error.code || "forbidden");
      return data as string | null;
    },
  };

  const paddle: PortalPaddle = {
    createPortalSession: async (customerId) => {
      const response = await fetch(
        `${paddleBase()}/customers/${encodeURIComponent(customerId)}/portal-sessions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "paddle-version": "1",
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error(`paddle_${response.status}`);
      const data = (await response.json()) as {
        data?: { urls?: { general?: { overview?: string } } };
      };
      const url = data.data?.urls?.general?.overview;
      if (typeof url !== "string") throw new Error("paddle_bad_response");
      return url;
    },
  };

  const { status, body: outBody } = await portalUrlFor(
    body.workspace_id,
    db,
    paddle,
  );
  return json(status, outBody);
});
