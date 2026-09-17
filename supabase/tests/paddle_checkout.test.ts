/**
 * The decision behind minting a Paddle transaction server-side: who may
 * check out for a workspace, and what happens when Paddle itself refuses.
 * Pure and injected, so it runs without a deployed project or a Paddle
 * account — the same shape as `_shared/billing-portal.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkoutTransactionFor,
  type CheckoutDb,
  type CheckoutPaddle,
} from "../functions/_shared/paddle-checkout.ts";

const W = "00000000-0000-4000-8000-000000000001";

function dbThatAllows(): CheckoutDb {
  return { assertMayCheckout: vi.fn().mockResolvedValue(undefined) };
}

function paddleThatMints(transactionId = "txn_1"): CheckoutPaddle {
  return { createTransaction: vi.fn().mockResolvedValue(transactionId) };
}

describe("checkoutTransactionFor", () => {
  it("refuses a price id that is not Paddle's shape, before touching the database", async () => {
    const db = dbThatAllows();
    const paddle = paddleThatMints();
    const outcome = await checkoutTransactionFor(
      W,
      "not-a-price",
      "a@b.c",
      db,
      paddle,
    );
    expect(outcome).toEqual({ status: 400, body: { code: "invalid_request" } });
    expect(db.assertMayCheckout).not.toHaveBeenCalled();
    expect(paddle.createTransaction).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not the workspace's owner", async () => {
    const db: CheckoutDb = {
      assertMayCheckout: vi.fn().mockRejectedValue(new Error("forbidden")),
    };
    const paddle = paddleThatMints();
    const outcome = await checkoutTransactionFor(
      W,
      "pri_m",
      "a@b.c",
      db,
      paddle,
    );
    expect(outcome).toEqual({ status: 403, body: { code: "forbidden" } });
    expect(paddle.createTransaction).not.toHaveBeenCalled();
  });

  it("treats a database error other than the ownership check as unavailable, never diagnosed", async () => {
    const db: CheckoutDb = {
      assertMayCheckout: vi
        .fn()
        .mockRejectedValue(new Error("connection refused")),
    };
    const outcome = await checkoutTransactionFor(
      W,
      "pri_m",
      "a@b.c",
      db,
      paddleThatMints(),
    );
    expect(outcome).toEqual({
      status: 502,
      body: { code: "checkout_unavailable" },
    });
  });

  it("mints a transaction with the workspace and the caller's own email, once the owner check passes", async () => {
    const db = dbThatAllows();
    const paddle = paddleThatMints("txn_42");
    const outcome = await checkoutTransactionFor(
      W,
      "pri_m",
      "a@b.c",
      db,
      paddle,
    );
    expect(paddle.createTransaction).toHaveBeenCalledWith({
      priceId: "pri_m",
      workspaceId: W,
      buyerEmail: "a@b.c",
    });
    expect(outcome).toEqual({
      status: 200,
      body: { transaction_id: "txn_42" },
    });
  });

  it("mints without a customer when the session carries no email", async () => {
    const db = dbThatAllows();
    const paddle = paddleThatMints();
    await checkoutTransactionFor(W, "pri_m", null, db, paddle);
    expect(paddle.createTransaction).toHaveBeenCalledWith({
      priceId: "pri_m",
      workspaceId: W,
      buyerEmail: null,
    });
  });

  it("never repeats Paddle's own error back to the caller", async () => {
    const db = dbThatAllows();
    const paddle: CheckoutPaddle = {
      createTransaction: vi
        .fn()
        .mockRejectedValue(new Error("paddle_422 price mismatch")),
    };
    const outcome = await checkoutTransactionFor(
      W,
      "pri_m",
      "a@b.c",
      db,
      paddle,
    );
    expect(outcome).toEqual({
      status: 502,
      body: { code: "checkout_unavailable" },
    });
  });
});
