/**
 * The browser's side of Paddle checkout and the billing portal.
 *
 * Checkout is Paddle.js's overlay (`paddleScript.load` fetches it from Paddle's
 * CDN the first time it is needed),
 * opened on a **transaction id**, not on a price and a customData this side
 * builds itself. The price id still comes from the tables
 * (`plans.provider_prices[interval]` for a plan, `addon_prices.
 * provider_prices.pack` for the pack, both written by
 * `scripts/paddle-sync-prices.mjs`), but the workspace being bought for is
 * fixed server-side: `paddle-checkout` checks the caller owns it and mints
 * the transaction with `custom_data.workspace_id` already in it before this
 * side ever sees a transaction id. A browser that changed `workspaceId`
 * before this point would only be asking to check out for a workspace it
 * does not own — `billing_assert_owner` refuses that before Paddle is ever
 * called — never able to put a different id in `custom_data`, which
 * `paddle-webhook` trusts completely once an event names a known price.
 *
 * Every checkout refusal is one error, `checkout_unavailable`: the callers
 * (`PricingPage`, `PlanPanel`) show it as `S.checkoutUnavailable`, and the
 * reason — no script, no token, no price id yet, no workspace, the server
 * refused to mint a transaction — is not a reader's to act on.
 *
 * The portal is a server round trip instead, to the `billing-portal`
 * function: it decides who may see a Paddle customer id
 * (`billing_customer_ref`, owner only), so this side only carries the
 * caller's own token there and follows the URL it answers with. Its one
 * distinguishable refusal is `no_paddle_customer` — a workspace never billed
 * through Paddle — which `PlanPanel` shows as its own sentence; anything else
 * collapses to `checkout_unavailable`, same as checkout.
 *
 * The only Paddle value the bundle carries is the client-side token
 * (`VITE_PADDLE_CLIENT_TOKEN`), which Paddle designs to be public; the API
 * key and the webhook secret never leave the server (`check-secrets.mjs`).
 */
import type { Session } from "@supabase/supabase-js";
import { AddonCatalogueSchema, type Plan } from "@sentiment/contracts";
import { readCatalogue } from "./planCatalogue";
import { supabase } from "./supabase";

export type CheckoutRequest = {
  planKey: string;
  interval: "month" | "year";
  session: Session;
  workspaceId?: string | null;
};

/** What `Paddle.Checkout.open` is handed — the part of Paddle.js this app
 *  uses. A transaction id, not items or customData: the price and the
 *  workspace are already fixed in it by `paddle-checkout`. */
export type CheckoutParams = {
  transactionId: string;
  settings: { successUrl: string };
};

type PaddleJs = {
  Environment: { set(env: "sandbox" | "production"): void };
  Initialize(options: { token: string }): void;
  Checkout: { open(params: CheckoutParams): void };
};

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

const unavailable = () => new Error("checkout_unavailable");

/** The provider's price id for a plan at an interval, or null before the
 *  sync script has written one — the case the button reports, not crashes on. */
export function priceIdFor(
  plan: Pick<Plan, "key" | "provider_prices">,
  interval: "month" | "year",
): string | null {
  const id = plan.provider_prices[interval];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** The overlay's parameters for an already-minted transaction: nothing but
 *  where to land, since the transaction itself already carries the price,
 *  the workspace and the buyer's email from the server that created it. */
export function checkoutParams(
  transactionId: string,
  origin: string,
): CheckoutParams {
  return {
    transactionId,
    settings: { successUrl: `${origin}/account?checkout=done` },
  };
}

// Paddle.js initialises once per page; a second `Initialize` is an error.
let initialised = false;

/** Paddle's script, fetched the first time a checkout or the portal is
 *  asked for — not from `index.html` on every page. Loaded eagerly it set a
 *  Cloudflare cookie on the landing page for a visitor who never buys, and
 *  cost every page 17 KiB it might never use. One in-flight promise, so two
 *  presses before the first load resolves inject one tag; a failed load
 *  clears it so the next press tries again. */
export const PADDLE_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";
let loading: Promise<void> | null = null;
export const paddleScript = {
  load(): Promise<void> {
    if (typeof window !== "undefined" && window.Paddle)
      return Promise.resolve();
    if (typeof document === "undefined") return Promise.reject(unavailable());
    loading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PADDLE_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(unavailable());
      };
      document.head.appendChild(script);
    });
    return loading;
  },
};

export async function initPaddle(): Promise<void> {
  if (initialised) return;
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  if (!token) throw unavailable();
  await paddleScript.load();
  const paddle = typeof window === "undefined" ? undefined : window.Paddle;
  if (!paddle) throw unavailable();
  paddle.Environment.set(
    import.meta.env.VITE_PADDLE_ENV === "live" ? "production" : "sandbox",
  );
  paddle.Initialize({ token });
  initialised = true;
}

/** The packs as `addon_catalogue()` answers them, parsed through the contract. */
async function readAddons() {
  if (!supabase) throw unavailable();
  const { data, error } = await supabase.rpc("addon_catalogue");
  if (error) throw unavailable();
  return AddonCatalogueSchema.parse(data);
}

/** The price id a request resolves to: the pack's for `pack_10k`, else the
 *  plan's for the interval. Null when the tables do not carry one yet. */
async function priceIdForRequest(req: CheckoutRequest) {
  if (req.planKey === "pack_10k") {
    const pack = (await readAddons()).find((a) => a.key === req.planKey);
    const id = pack?.provider_prices.pack;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  const plan = (await readCatalogue()).find((p) => p.key === req.planKey);
  return plan ? priceIdFor(plan, req.interval) : null;
}

/** Asks `paddle-checkout` to mint a transaction for this workspace and price,
 *  carrying the caller's own token so `billing_assert_owner` checks them,
 *  never a workspace this side decided on their behalf. */
async function mintTransaction(
  session: Session,
  workspaceId: string,
  priceId: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paddle-checkout`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId, price_id: priceId }),
      },
    );
  } catch {
    throw unavailable();
  }
  const body = (await response.json().catch(() => ({}))) as {
    transaction_id?: string;
  };
  if (!response.ok || typeof body.transaction_id !== "string")
    throw unavailable();
  return body.transaction_id;
}

export async function openCheckout(req: CheckoutRequest): Promise<void> {
  // The workspace is resolved before anything is fetched: a checkout with
  // nobody to bill would be an event the webhook records as unmapped. Then
  // Paddle.js, before the catalogue: a deployment without the script or the
  // token fails at once, not after a round trip.
  const workspaceId = req.workspaceId ?? null;
  if (!workspaceId) throw unavailable();
  await initPaddle();
  const priceId = await priceIdForRequest(req);
  if (!priceId) throw unavailable();
  const transactionId = await mintTransaction(
    req.session,
    workspaceId,
    priceId,
  );
  window.Paddle!.Checkout.open(
    checkoutParams(transactionId, window.location.origin),
  );
}

/** Opens Paddle's hosted portal for the workspace's own subscription. The
 *  function decides who may see a customer id (`billing_customer_ref`, owner
 *  only); this side only carries the caller's token there and follows the
 *  URL it answers with. A workspace never billed through Paddle answers
 *  `no_paddle_customer`, which the caller shows as its own sentence rather
 *  than the generic `checkout_unavailable`. */
export async function openPortal(
  session: Session,
  workspaceId: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-portal`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
      },
    );
  } catch {
    throw unavailable();
  }
  const body = (await response.json().catch(() => ({}))) as {
    url?: string;
    code?: string;
  };
  if (response.status === 404 && body.code === "no_paddle_customer")
    throw new Error("no_paddle_customer");
  if (!response.ok || typeof body.url !== "string") throw unavailable();
  window.location.assign(body.url);
}
