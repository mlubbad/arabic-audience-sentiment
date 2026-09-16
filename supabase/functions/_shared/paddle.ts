/**
 * Paddle's webhook, understood once and applied through injected RPCs.
 *
 * Two things happen here and nothing else. The signature on the raw body is
 * checked, so that a request is Paddle's before it is read. Then one event is
 * turned into one call on the data layer: a subscription event into
 * applySubscription, a completed pack transaction into applyPack, and anything
 * that cannot be tied to a workspace and a known price into recordUnmapped.
 *
 * Every decided outcome answers 200. Paddle retries a non-2xx for days, and an
 * event we cannot map today will not map better tomorrow; it is recorded so a
 * person can look, and acknowledged so the queue moves on. A thrown error is
 * the one path that is not 200, and it belongs to the entry point, which turns
 * it into a 500 that Paddle will retry.
 *
 * Pure, with the database injected, so it is tested without a deployed project
 * and without a Paddle account — the same shape as worker-gateway.ts. Nothing
 * here touches a Deno global, so vitest imports it under Node.
 */
export type SubscriptionStatus = "active" | "past_due" | "paused" | "cancelled";
export type BillingInterval = "month" | "year";

export interface BillingDb {
  /** `'<plan>:<month|year>'`, `'pack_10k:pack'`, or null for a price we do not sell. */
  planForPrice(priceId: string): Promise<string | null>;
  applySubscription(a: {
    eventId: string;
    eventType: string;
    occurredAt: string;
    workspaceId: string;
    plan: string;
    interval: BillingInterval;
    periodStart: string;
    periodEnd: string;
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    providerRef: string;
    customerRef: string | null;
    payload: unknown;
  }): Promise<string>;
  applyPack(a: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    kind: string;
    units: number;
    providerRef: string;
    payload: unknown;
  }): Promise<string>;
  recordUnmapped(
    eventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<void>;
}

export type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
};

export type PaddleOutcome = { status: number; body: { outcome: string } };

/** How far a signature's timestamp may sit from now, either way. */
export const SIGNATURE_TOLERANCE_MS = 300_000;

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Equal length and equal bytes, read to the end whatever the first mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `Paddle-Signature: ts=<unix seconds>;h1=<hex>`, where
 * h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`) over the body exactly as
 * received. More than one h1 appears while Paddle rotates a secret; any one
 * matching is enough. A missing or malformed header is simply not a signature.
 */
export async function verifyPaddleSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!header) return false;
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1") h1.push(v);
  }
  if (!ts || !/^\d+$/.test(ts) || h1.length === 0) return false;
  if (Math.abs(now - Number(ts) * 1000) > SIGNATURE_TOLERANCE_MS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${ts}:${rawBody}`),
    ),
  );
  let ok = false;
  for (const candidate of h1) {
    if (constantTimeEqual(mac, candidate.toLowerCase())) ok = true;
  }
  return ok;
}

/** Paddle's subscription status words, in ours. Trialing is active: it has a plan. */
const STATUS: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  paused: "paused",
  canceled: "cancelled",
};

/** The packs we sell, by the addon key `plan_key_for_price` returns before `:pack`. */
const PACKS: Record<string, { kind: string; units: number }> = {
  pack_10k: { kind: "comment_analysis", units: 10000 },
};

/** One interval on from an instant, in UTC, for an event that names no period. */
const ADD: Record<BillingInterval, (iso: string) => string> = {
  month: (iso) => {
    const t = new Date(iso);
    t.setUTCMonth(t.getUTCMonth() + 1);
    return t.toISOString();
  },
  year: (iso) => {
    const t = new Date(iso);
    t.setUTCFullYear(t.getUTCFullYear() + 1);
    return t.toISOString();
  },
};

type PaddleData = {
  id?: string;
  status?: string;
  customer_id?: string | null;
  custom_data?: { workspace_id?: string } | null;
  items?: { price?: { id?: string } }[] | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  scheduled_change?: { action?: string } | null;
};

const answer = (outcome: string): PaddleOutcome => ({
  status: 200,
  body: { outcome },
});

export async function handlePaddleEvent(
  event: PaddleEvent,
  db: BillingDb,
): Promise<PaddleOutcome> {
  const d = event.data as PaddleData;
  const workspaceId = d.custom_data?.workspace_id;
  const priceId = d.items?.[0]?.price?.id;
  const unmapped = async () => {
    await db.recordUnmapped(event.event_id, event.event_type, d);
    return answer("unmapped");
  };
  if (!workspaceId || !priceId || !d.id) return unmapped();
  const mapped = await db.planForPrice(priceId);
  if (!mapped) return unmapped();
  const [plan, interval] = mapped.split(":") as [
    string,
    BillingInterval | "pack",
  ];

  if (event.event_type === "transaction.completed") {
    // A subscription's payment is not the truth about the subscription; the
    // subscription events are. Only a pack is granted from its transaction.
    const pack = PACKS[plan];
    if (interval !== "pack" || !pack) return answer("ignored");
    return answer(
      await db.applyPack({
        eventId: event.event_id,
        occurredAt: event.occurred_at,
        workspaceId,
        kind: pack.kind,
        units: pack.units,
        providerRef: d.id,
        payload: d,
      }),
    );
  }
  if (!event.event_type.startsWith("subscription.")) return answer("ignored");
  // A subscription priced as a pack is not a plan we sell; someone should look.
  if (interval === "pack" || !(interval in ADD)) return unmapped();
  const status = STATUS[d.status ?? ""] ?? "active";
  const periodStart = d.current_billing_period?.starts_at ?? event.occurred_at;
  const periodEnd =
    d.current_billing_period?.ends_at ?? ADD[interval](event.occurred_at);
  return answer(
    await db.applySubscription({
      eventId: event.event_id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      workspaceId,
      plan,
      interval,
      periodStart,
      periodEnd,
      status,
      cancelAtPeriodEnd: d.scheduled_change?.action === "cancel",
      providerRef: d.id,
      customerRef: d.customer_id ?? null,
      payload: d,
    }),
  );
}
