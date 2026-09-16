/**
 * The customer portal: a signed-in workspace owner's own Paddle subscription,
 * reached through Paddle's hosted portal rather than anything this app builds.
 *
 * The workspace is never trusted for who may read its Paddle customer id —
 * `billing_customer_ref` (20260917051000) is `security definer` SQL that
 * checks the caller holds `workspace_owner` on the root before answering, and
 * raises `forbidden` otherwise. This handler only relays that decision: it
 * never re-derives ownership itself, and it never repeats a driver or Paddle
 * error message back to the caller, since either can quote a connection
 * string or a key.
 *
 * Pure, with the database and Paddle both injected, so it is tested without a
 * deployed project and without a Paddle account — the same shape as
 * `paddle.ts` and `worker-gateway.ts`.
 */

/** The one read this handler needs: the ROOT's Paddle customer id for a
 *  workspace, or null when that root has never been billed through Paddle. A
 *  throw whose `message` is `"forbidden"` is the ownership check failing;
 *  any other throw is treated as unavailable, not diagnosed. */
export interface PortalDb {
  customerRefFor(workspaceId: string): Promise<string | null>;
}

/** Paddle's own portal-sessions call, given the customer id and answering the
 *  URL to send the owner to. */
export interface PortalPaddle {
  createPortalSession(customerId: string): Promise<string>;
}

export type PortalOutcome =
  | { status: 200; body: { url: string } }
  | { status: 403; body: { code: "forbidden" } }
  | { status: 404; body: { code: "no_paddle_customer" } }
  | { status: 502; body: { code: "portal_unavailable" } };

// The entry throws with `message` set to the SQL error's own text ("forbidden"
// for the ownership check); nothing here constructs a `.code`, so only
// `message` is ever checked — the shape a real caller can actually produce.
const isForbidden = (error: unknown): boolean =>
  (error as { message?: unknown } | undefined)?.message === "forbidden";

// Paddle's own customer id shape. A ref that fails this was never going to
// be a usable customer — checked here, before it is put anywhere near a URL
// or a Paddle call, rather than trusted because the database returned it.
const CUSTOMER_REF = /^ctm_[A-Za-z0-9]+$/;

export async function portalUrlFor(
  workspaceId: string,
  db: PortalDb,
  paddle: PortalPaddle,
): Promise<PortalOutcome> {
  let customerId: string | null;
  try {
    customerId = await db.customerRefFor(workspaceId);
  } catch (error) {
    if (isForbidden(error)) return { status: 403, body: { code: "forbidden" } };
    // A driver error can quote the connection string; it never reaches the caller.
    return { status: 502, body: { code: "portal_unavailable" } };
  }
  if (!customerId || !CUSTOMER_REF.test(customerId))
    return { status: 404, body: { code: "no_paddle_customer" } };

  try {
    const url = await paddle.createPortalSession(customerId);
    return { status: 200, body: { url } };
  } catch {
    // Same reasoning: Paddle's own error text is not this handler's to relay.
    return { status: 502, body: { code: "portal_unavailable" } };
  }
}
