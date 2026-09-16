/**
 * The browser's side of Paddle checkout and the billing portal.
 *
 * Stubs for now, so the pricing page (B2) and the account's plan card (B3)
 * can be written against the real signatures before the provider exists:
 * both throw `checkout_unavailable`, and the callers show that as a sentence
 * rather than a crash. Task C4 replaces `openCheckout` with Paddle.js and
 * the `billing_checkout` function; C5 replaces `openPortal` with the portal
 * session. Their tests (`paddle.test.ts`) arrive with them.
 */
import type { Session } from "@supabase/supabase-js";

export type CheckoutRequest = {
  planKey: string;
  interval: "month" | "year";
  session: Session;
  workspaceId?: string | null;
};

// The parameters are the contract; the bodies are C4's and C5's to fill.
export async function openCheckout(req: CheckoutRequest): Promise<never> {
  void req;
  throw new Error("checkout_unavailable");
}

export async function openPortal(
  session: Session,
  workspaceId: string,
): Promise<never> {
  void session;
  void workspaceId;
  throw new Error("checkout_unavailable");
}
