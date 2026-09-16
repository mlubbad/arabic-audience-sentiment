/**
 * The customer portal's pure handler: a Paddle customer id in, a portal URL
 * out, or the one refusal the caller may act on.
 *
 * The handler takes db and paddle injected, so it is tested without a
 * deployed project and without a Paddle account — the same shape as
 * paddle.ts and worker-gateway.ts.
 */
import { describe, expect, it } from "vitest";
import { portalUrlFor } from "../functions/_shared/billing-portal.ts";

describe("billing portal", () => {
  it("returns the portal url for a paddle customer", async () => {
    const r = await portalUrlFor(
      "w1",
      { customerRefFor: async () => "ctm_1" },
      { createPortalSession: async (c) => `https://portal/${c}` },
    );
    expect(r).toEqual({ status: 200, body: { url: "https://portal/ctm_1" } });
  });

  it("a workspace without a paddle customer is told so", async () => {
    const r = await portalUrlFor(
      "w1",
      { customerRefFor: async () => null },
      { createPortalSession: async () => "x" },
    );
    expect(r).toEqual({ status: 404, body: { code: "no_paddle_customer" } });
  });

  it("a non-owner reading billing_customer_ref is refused, not told a customer id", async () => {
    const r = await portalUrlFor(
      "w1",
      {
        customerRefFor: async () => {
          throw new Error("forbidden");
        },
      },
      { createPortalSession: async () => "x" },
    );
    expect(r).toEqual({ status: 403, body: { code: "forbidden" } });
  });

  it("any other db failure is a 502 that carries no message", async () => {
    const r = await portalUrlFor(
      "w1",
      {
        customerRefFor: async () => {
          throw new Error("connection reset by peer at db.internal:5432");
        },
      },
      { createPortalSession: async () => "x" },
    );
    expect(r).toEqual({ status: 502, body: { code: "portal_unavailable" } });
  });

  it("a Paddle failure is a 502 that carries no message either", async () => {
    const r = await portalUrlFor(
      "w1",
      { customerRefFor: async () => "ctm_1" },
      {
        createPortalSession: async () => {
          throw new Error("paddle_500: pdl_apikey_leaked_in_error");
        },
      },
    );
    expect(r).toEqual({ status: 502, body: { code: "portal_unavailable" } });
  });
});
