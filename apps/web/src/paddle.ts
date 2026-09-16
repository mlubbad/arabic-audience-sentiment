/**
 * The browser's side of Paddle checkout and the billing portal.
 *
 * Checkout is Paddle.js's overlay (`index.html` loads it from Paddle's CDN),
 * opened on a price id the tables carry: `plans.provider_prices[interval]`
 * for a plan, `addon_prices.provider_prices.pack` for the pack, both written
 * there by `scripts/paddle-sync-prices.mjs` and read here through the same
 * public functions the pricing page reads. The workspace being bought for
 * rides in `customData`, which is how the webhook (`paddle-webhook`) knows
 * whose subscription an event is; without one there is nothing to bill and
 * the overlay never opens.
 *
 * Every refusal is one error, `checkout_unavailable`: the callers
 * (`PricingPage`, `PlanPanel`) show it as `S.checkoutUnavailable`, and the
 * reason — no script, no token, no price id yet, no workspace — is not a
 * reader's to act on. `openPortal` stays a stub until C5.
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

/** What `Paddle.Checkout.open` is handed — the part of Paddle.js this app uses. */
export type CheckoutParams = {
  items: { priceId: string; quantity: number }[];
  customData: { workspace_id: string };
  customer?: { email: string };
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

/** The overlay's parameters: one item, the workspace in custom data so the
 *  webhook can land the event, the buyer's email when the session has one,
 *  and the account page as the place to come back to. */
export function checkoutItems(
  priceId: string,
  workspaceId: string,
  email: string | null | undefined,
  origin: string,
): CheckoutParams {
  const params: CheckoutParams = {
    items: [{ priceId, quantity: 1 }],
    customData: { workspace_id: workspaceId },
    settings: { successUrl: `${origin}/account?checkout=done` },
  };
  if (email) params.customer = { email };
  return params;
}

// Paddle.js initialises once per page; a second `Initialize` is an error.
let initialised = false;

export async function initPaddle(): Promise<void> {
  if (initialised) return;
  const paddle = typeof window === "undefined" ? undefined : window.Paddle;
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  if (!paddle || !token) throw unavailable();
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
  window.Paddle!.Checkout.open(
    checkoutItems(
      priceId,
      workspaceId,
      req.session.user.email,
      window.location.origin,
    ),
  );
}

export async function openPortal(
  session: Session,
  workspaceId: string,
): Promise<never> {
  void session;
  void workspaceId;
  throw new Error("checkout_unavailable");
}
