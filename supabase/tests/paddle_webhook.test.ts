/**
 * Paddle's webhook, understood once: the signature, the status map, the pack,
 * and the events that cannot be mapped to a workspace or a price.
 *
 * The handler is pure and takes an injected data layer, so nothing here needs
 * a deployed project or a Paddle account.
 */
import { describe, expect, it } from "vitest";
import {
  handlePaddleEvent,
  verifyPaddleSignature,
  type BillingDb,
} from "../functions/_shared/paddle.ts";

type SubArgs = Parameters<BillingDb["applySubscription"]>[0];

const W = "00000000-0000-4000-8000-000000000001";
const sub = (over: Record<string, unknown> = {}) => ({
  event_id: "evt_1",
  event_type: "subscription.activated",
  occurred_at: "2026-09-17T10:00:00Z",
  data: {
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    custom_data: { workspace_id: W },
    items: [{ price: { id: "pri_m" }, quantity: 1 }],
    current_billing_period: {
      starts_at: "2026-09-17T10:00:00Z",
      ends_at: "2026-10-17T10:00:00Z",
    },
    scheduled_change: null,
    ...over,
  },
});
const fakeDb = () => {
  const calls: unknown[] = [];
  const db: BillingDb = {
    planForPrice: async (id) =>
      id === "pri_m"
        ? "creator:month"
        : id === "pri_pack"
          ? "pack_10k:pack"
          : null,
    applySubscription: async (a) => {
      calls.push(["sub", a]);
      return "applied";
    },
    applyPack: async (a) => {
      calls.push(["pack", a]);
      return "applied";
    },
    recordUnmapped: async (id, type) => {
      calls.push(["unmapped", id, type]);
    },
  };
  return { db, calls };
};
const subArgs = (call: unknown) => (call as ["sub", SubArgs])[1];

describe("paddle webhook", () => {
  it("verifies a signature and rejects a stale timestamp", async () => {
    const secret = "pdl_ntfset_test";
    const body = '{"a":1}';
    const ts = 1_700_000_000;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          new TextEncoder().encode(`${ts}:${body}`),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=${mac}`,
        body,
        secret,
        ts * 1000 + 1000,
      ),
    ).toBe(true);
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=${mac}`,
        body,
        secret,
        ts * 1000 + 600_000,
      ),
    ).toBe(false);
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=deadbeef`,
        body,
        secret,
        ts * 1000,
      ),
    ).toBe(false);
    expect(await verifyPaddleSignature(null, body, secret, ts * 1000)).toBe(
      false,
    );
  });
  it("an activated subscription becomes creator, monthly, active", async () => {
    const { db, calls } = fakeDb();
    const r = await handlePaddleEvent(sub(), db);
    expect(r).toEqual({ status: 200, body: { outcome: "applied" } });
    expect(calls[0]).toEqual([
      "sub",
      {
        eventId: "evt_1",
        eventType: "subscription.activated",
        occurredAt: "2026-09-17T10:00:00Z",
        workspaceId: W,
        plan: "creator",
        interval: "month",
        periodStart: "2026-09-17T10:00:00Z",
        periodEnd: "2026-10-17T10:00:00Z",
        status: "active",
        cancelAtPeriodEnd: false,
        providerRef: "sub_1",
        customerRef: "ctm_1",
        payload: sub().data,
      },
    ]);
  });
  it("a scheduled cancel is cancel_at_period_end; canceled is cancelled; past_due is past_due", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(
      sub({ scheduled_change: { action: "cancel" } }),
      db,
    );
    await handlePaddleEvent(sub({ status: "canceled" }), db);
    await handlePaddleEvent(sub({ status: "past_due" }), db);
    expect(subArgs(calls[0]).cancelAtPeriodEnd).toBe(true);
    expect(subArgs(calls[1]).status).toBe("cancelled");
    expect(subArgs(calls[2]).status).toBe("past_due");
  });
  it("a completed pack transaction grants units; a subscription transaction is ignored", async () => {
    const { db, calls } = fakeDb();
    const txn = (price: string) => ({
      event_id: "evt_t",
      event_type: "transaction.completed",
      occurred_at: "2026-09-17T10:00:00Z",
      data: {
        id: "txn_1",
        custom_data: { workspace_id: W },
        items: [{ price: { id: price }, quantity: 1 }],
      },
    });
    expect((await handlePaddleEvent(txn("pri_pack"), db)).body.outcome).toBe(
      "applied",
    );
    expect(calls[0]).toEqual([
      "pack",
      {
        eventId: "evt_t",
        occurredAt: "2026-09-17T10:00:00Z",
        workspaceId: W,
        kind: "comment_analysis",
        units: 10000,
        providerRef: "txn_1",
        payload: txn("pri_pack").data,
      },
    ]);
    expect((await handlePaddleEvent(txn("pri_m"), db)).body.outcome).toBe(
      "ignored",
    );
  });
  it("no workspace id is recorded as unmapped and answered 200", async () => {
    const { db, calls } = fakeDb();
    const r = await handlePaddleEvent(sub({ custom_data: {} }), db);
    expect(r.status).toBe(200);
    expect(calls[0]).toEqual(["unmapped", "evt_1", "subscription.activated"]);
  });
  it("an unknown price is unmapped, not applied", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(
      sub({ items: [{ price: { id: "pri_zzz" }, quantity: 1 }] }),
      db,
    );
    expect((calls[0] as unknown[])[0]).toBe("unmapped");
  });
});

describe("paddle webhook, the edges", () => {
  it("an event naming no billing period runs one interval from when it occurred", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(sub({ current_billing_period: null }), db);
    expect(subArgs(calls[0]).periodStart).toBe("2026-09-17T10:00:00Z");
    expect(subArgs(calls[0]).periodEnd).toBe("2026-10-17T10:00:00.000Z");
  });
  it("a subscription priced as a pack is unmapped; an event of another kind is ignored", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(
      sub({ items: [{ price: { id: "pri_pack" }, quantity: 1 }] }),
      db,
    );
    expect(calls[0]).toEqual(["unmapped", "evt_1", "subscription.activated"]);
    const r = await handlePaddleEvent(
      { ...sub(), event_type: "customer.updated" },
      db,
    );
    expect(r).toEqual({ status: 200, body: { outcome: "ignored" } });
    expect(calls.length).toBe(1);
  });
  it("trialing is active and paused is paused", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(sub({ status: "trialing" }), db);
    await handlePaddleEvent(sub({ status: "paused" }), db);
    expect(subArgs(calls[0]).status).toBe("active");
    expect(subArgs(calls[1]).status).toBe("paused");
  });
  it("a malformed header, a rotated pair, and a wrong secret", async () => {
    const secret = "pdl_ntfset_test";
    const body = '{"a":1}';
    const ts = 1_700_000_000;
    const sign = async (s: string) => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(s),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return Array.from(
        new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(`${ts}:${body}`),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };
    const good = await sign(secret);
    const other = await sign("pdl_ntfset_old");
    expect(
      await verifyPaddleSignature("garbage", body, secret, ts * 1000),
    ).toBe(false);
    expect(
      await verifyPaddleSignature(`h1=${good}`, body, secret, ts * 1000),
    ).toBe(false);
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=${other};h1=${good}`,
        body,
        secret,
        ts * 1000,
      ),
    ).toBe(true);
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=${other}`,
        body,
        secret,
        ts * 1000,
      ),
    ).toBe(false);
    expect(
      await verifyPaddleSignature(
        `ts=${ts};h1=${good}`,
        "{}",
        secret,
        ts * 1000,
      ),
    ).toBe(false);
  });
});
