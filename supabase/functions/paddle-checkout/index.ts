/**
 * Mints a Paddle transaction for a signed-in owner's own workspace.
 *
 * Runs as the caller, not as the service: the anon key plus the caller's own
 * `authorization` header (the pattern `billing-portal` and `oauth-start`
 * use), so `billing_assert_owner` (20260917120000) — `security definer` SQL
 * that requires `workspace_owner` on the workspace — is the thing that
 * decides whether this caller may check out for it, not anything here. A
 * `workspace_id` in the body is never trusted on its own, and the buyer's
 * email comes from their verified session, never from the request body.
 *
 * Deployed WITH the gateway's JWT check, like `billing-portal` and unlike
 * `paddle-webhook`: the caller here is a signed-in user with a Supabase
 * token, not Paddle with an HMAC.
 *
 * The pure decision — a transaction id, or the one refusal to make — lives
 * in `_shared/paddle-checkout.ts` and is tested there without a project.
 * This file is only the two side effects that decision needs: the RPC call
 * and the call to Paddle's API.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  checkoutTransactionFor,
  type CheckoutDb,
  type CheckoutPaddle,
} from "../_shared/paddle-checkout.ts";
import { corsHeaders, parseOrigins, preflight } from "../_shared/cors.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

// Sandbox by design unless explicitly told otherwise — the same default
// `billing-portal`, `scripts/paddle-sync-lib.mjs` and `apps/web/src/paddle.ts`
// use, so an unset or misspelled PADDLE_ENV never lands a real card against
// production.
const paddleBase = () =>
  env("PADDLE_ENV") === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

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
  const auth = request.headers.get("authorization");
  if (!auth) return json(401, { code: "unauthenticated" });

  let body: { workspace_id?: string; price_id?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (
    !body.workspace_id ||
    typeof body.workspace_id !== "string" ||
    !body.price_id ||
    typeof body.price_id !== "string"
  )
    return json(400, { code: "invalid_request" });

  // An unset key is not a key anyone could call Paddle with: refuse before
  // touching the database or Paddle, the same misconfiguration answer
  // billing-portal and paddle-webhook give for their own secret.
  const apiKey = env("PADDLE_API_KEY");
  if (!apiKey) return json(500, { code: "not_configured" });

  // The caller's own token, so the RPC's ownership check applies to them —
  // never to a workspace this function decided on their behalf.
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });

  // The buyer's email as their own session names it — not a field the
  // request body could set, so a Paddle transaction can never carry someone
  // else's address.
  const {
    data: { user },
  } = await client.auth.getUser();

  const db: CheckoutDb = {
    assertMayCheckout: async (w) => {
      const { error } = await client.rpc("billing_assert_owner", { w });
      if (error) throw new Error(error.message || error.code || "forbidden");
    },
  };

  const paddle: CheckoutPaddle = {
    createTransaction: async ({ priceId, workspaceId, buyerEmail }) => {
      const response = await fetch(`${paddleBase()}/transactions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "paddle-version": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [{ price_id: priceId, quantity: 1 }],
          custom_data: { workspace_id: workspaceId },
          ...(buyerEmail ? { customer: { email: buyerEmail } } : {}),
        }),
      });
      if (!response.ok) throw new Error(`paddle_${response.status}`);
      const data = (await response.json()) as { data?: { id?: string } };
      const id = data.data?.id;
      if (typeof id !== "string") throw new Error("paddle_bad_response");
      return id;
    },
  };

  const { status, body: outBody } = await checkoutTransactionFor(
    body.workspace_id,
    body.price_id,
    user?.email ?? null,
    db,
    paddle,
  );
  return json(status, outBody);
});
