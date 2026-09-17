/**
 * A checkout the browser cannot steer to someone else's workspace.
 *
 * Paddle.js used to open with `customData` the browser built from its own
 * state (`apps/web/src/paddle.ts`), and the webhook (`_shared/paddle.ts`)
 * trusts `custom_data.workspace_id` completely — so any caller who could
 * reach the checkout button could name any workspace's id and have Paddle's
 * event land a plan, or a customer ref, on it. The fix is to never let the
 * browser choose: this mints the Paddle transaction here, after checking the
 * caller owns the workspace, and hands the browser only the transaction id.
 * `Paddle.Checkout.open({ transactionId })` cannot carry a different
 * workspace than the one this function put in it.
 *
 * Pure, with the database and Paddle both injected, so it is tested without a
 * deployed project and without a Paddle account — the same shape as
 * `billing-portal.ts` and `worker-gateway.ts`.
 */

/** The one check this handler needs: does the caller own this workspace? A
 *  throw whose `message` is `"forbidden"` is that check failing; any other
 *  throw is treated as unavailable, not diagnosed. */
export interface CheckoutDb {
  assertMayCheckout(workspaceId: string): Promise<void>;
}

/** Paddle's own transaction creation, given the price, the workspace to bill
 *  it against, and the buyer's email from their own verified session — never
 *  from anything the caller supplied. Answers the transaction id. */
export interface CheckoutPaddle {
  createTransaction(a: {
    priceId: string;
    workspaceId: string;
    buyerEmail: string | null;
  }): Promise<string>;
}

export type CheckoutOutcome =
  | { status: 200; body: { transaction_id: string } }
  | { status: 400; body: { code: "invalid_request" } }
  | { status: 403; body: { code: "forbidden" } }
  | { status: 502; body: { code: "checkout_unavailable" } };

// The entry throws with `message` set to the SQL error's own text ("forbidden"
// for the ownership check); nothing here constructs a `.code`, so only
// `message` is ever checked — the shape a real caller can actually produce.
const isForbidden = (error: unknown): boolean =>
  (error as { message?: unknown } | undefined)?.message === "forbidden";

// Paddle's own price id shape, checked before anything is asked of the
// database or of Paddle — a malformed id was never going to buy anything.
const PRICE_ID = /^pri_[A-Za-z0-9]+$/;

export async function checkoutTransactionFor(
  workspaceId: string,
  priceId: string,
  buyerEmail: string | null,
  db: CheckoutDb,
  paddle: CheckoutPaddle,
): Promise<CheckoutOutcome> {
  if (!PRICE_ID.test(priceId))
    return { status: 400, body: { code: "invalid_request" } };

  try {
    await db.assertMayCheckout(workspaceId);
  } catch (error) {
    if (isForbidden(error)) return { status: 403, body: { code: "forbidden" } };
    // A driver error can quote the connection string; it never reaches the caller.
    return { status: 502, body: { code: "checkout_unavailable" } };
  }

  try {
    const transactionId = await paddle.createTransaction({
      priceId,
      workspaceId,
      buyerEmail,
    });
    return { status: 200, body: { transaction_id: transactionId } };
  } catch {
    // Same reasoning: Paddle's own error text is not this handler's to relay.
    return { status: 502, body: { code: "checkout_unavailable" } };
  }
}
