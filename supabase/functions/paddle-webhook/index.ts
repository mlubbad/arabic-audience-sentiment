/**
 * Paddle's webhook. Service role, because the caller is Paddle and not a
 * signed-in user: the HMAC on the raw body is the authentication, checked
 * before the body is read as anything, and the function is deployed with
 * verify_jwt off because Paddle carries no Supabase token.
 *
 * Nothing in the body is trusted for authorization. The workspace it names is
 * Paddle's custom_data, echoed from checkout; the database lands the event on
 * that workspace's billing root and refuses a price it does not sell. The
 * `public.billing_*` wrappers (20260917051000) are the whole surface this
 * key reaches, each revoked from every tenant role.
 *
 * Every decided outcome is a 200 so Paddle stops retrying; a database error
 * is the one 500, carrying a code and no message, because a driver error can
 * quote the connection string.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  type BillingDb,
  handlePaddleEvent,
  type PaddleEvent,
  verifyPaddleSignature,
} from "../_shared/paddle.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const rpc = async <T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw Object.assign(new Error(fn), { code: error.code });
  return data as T;
};

const billing: BillingDb = {
  planForPrice: (price_id) =>
    rpc<string | null>("billing_plan_for_price", { price_id }),
  // The handler says `interval`; the SQL parameter is `billing_interval`.
  applySubscription: (a) =>
    rpc<string>("billing_apply_subscription", {
      event_id: a.eventId,
      event_type: a.eventType,
      occurred_at: a.occurredAt,
      w: a.workspaceId,
      plan: a.plan,
      billing_interval: a.interval,
      period_start: a.periodStart,
      period_end: a.periodEnd,
      status: a.status,
      cancel_at_period_end: a.cancelAtPeriodEnd,
      provider_ref: a.providerRef,
      customer_ref: a.customerRef,
      payload: a.payload,
    }),
  applyPack: (a) =>
    rpc<string>("billing_apply_pack", {
      event_id: a.eventId,
      occurred_at: a.occurredAt,
      w: a.workspaceId,
      kind: a.kind,
      units: a.units,
      provider_ref: a.providerRef,
      payload: a.payload,
    }),
  recordUnmapped: async (event_id, event_type, payload) => {
    await rpc<null>("billing_record_unmapped", {
      event_id,
      event_type,
      payload,
    });
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The four fields the handler reads, present and of the right shape. */
const isPaddleEvent = (v: unknown): v is PaddleEvent =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as PaddleEvent).event_id === "string" &&
  typeof (v as PaddleEvent).event_type === "string" &&
  typeof (v as PaddleEvent).occurred_at === "string" &&
  typeof (v as PaddleEvent).data === "object" &&
  (v as PaddleEvent).data !== null;

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });

  // An unset secret is not a secret anyone could match against: refuse the
  // request as a misconfiguration rather than sign with an empty key. Paddle
  // retries a 500, so nothing is lost while the secret is being set.
  const secret = env("PADDLE_WEBHOOK_SECRET");
  if (!secret) return json(500, { code: "not_configured" });

  // The signature is over the body exactly as received, so it is read as text
  // and verified before anything parses it.
  const raw = await request.text();
  const signed = await verifyPaddleSignature(
    request.headers.get("paddle-signature"),
    raw,
    secret,
  );
  if (!signed) return json(401, { code: "bad_signature" });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (!isPaddleEvent(event)) return json(400, { code: "invalid_request" });

  try {
    const { status, body } = await handlePaddleEvent(event, billing);
    return json(status, body);
  } catch (error) {
    // Paddle retries a 500 for days, which is what a database that could not
    // answer deserves. The code is logged; the message stays on this side.
    console.error("paddle-webhook", (error as { code?: string })?.code ?? "");
    return json(500, { code: "internal" });
  }
});
