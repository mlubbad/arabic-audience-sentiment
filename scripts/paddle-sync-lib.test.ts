import { describe, expect, it } from "vitest";
import {
  desiredPrices,
  diff,
  planProducts,
  priceBody,
  productBody,
  providerPrices,
  summary,
} from "./paddle-sync-lib.mjs";

// The rows as the plans table and addon_prices answer them (20260917010000,
// 20260917050000): the pure functions decide what Paddle should hold from
// them, and the script only carries the answer across.
const plans = [
  {
    key: "free",
    title_en: "Free",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: true,
    internal: false,
  },
  {
    key: "creator",
    title_en: "Creator",
    price_monthly_cents: 1200,
    price_yearly_cents: 12000,
    self_serve: true,
    internal: false,
  },
  {
    key: "creator_plus",
    title_en: "Creator Plus",
    price_monthly_cents: 2900,
    price_yearly_cents: 28800,
    self_serve: true,
    internal: false,
  },
  {
    key: "agency",
    title_en: "Agency",
    price_monthly_cents: 9900,
    price_yearly_cents: 94800,
    self_serve: true,
    internal: false,
  },
  {
    key: "media",
    title_en: "Media",
    price_monthly_cents: 24900,
    price_yearly_cents: 238800,
    self_serve: false,
    internal: false,
  },
  {
    key: "enterprise",
    title_en: "Enterprise",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: false,
    internal: false,
  },
  {
    key: "owner",
    title_en: "Owner",
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    self_serve: false,
    internal: true,
  },
];
const addons = [
  { key: "pack_10k", kind: "comment_analysis", units: 10000, price_cents: 500 },
];

describe("planProducts", () => {
  it("wants one product per self-serve paid plan and one per pack, nothing else", () => {
    expect(planProducts(plans, addons).map((p) => p.plan_key)).toEqual([
      "creator",
      "creator_plus",
      "agency",
      "pack_10k",
    ]);
  });
  it("names a product after the plan's English title and a pack after its units", () => {
    const products = planProducts(plans, addons);
    expect(products[0]).toMatchObject({
      plan_key: "creator",
      name: "Creator",
      kind: "plan",
    });
    expect(products[3]).toMatchObject({
      plan_key: "pack_10k",
      name: "Analysis pack — 10,000 comments",
      kind: "pack",
    });
  });
});

describe("desiredPrices", () => {
  it("wants a monthly and a yearly recurring price for a plan, in cents as a string", () => {
    expect(desiredPrices(planProducts(plans, addons)[0])).toEqual([
      {
        plan_key: "creator",
        interval: "month",
        amount: "1200",
        description: "Creator — monthly",
      },
      {
        plan_key: "creator",
        interval: "year",
        amount: "12000",
        description: "Creator — yearly",
      },
    ]);
  });
  it("wants one one-time price for a pack", () => {
    expect(desiredPrices(planProducts(plans, addons)[3])).toEqual([
      {
        plan_key: "pack_10k",
        interval: "pack",
        amount: "500",
        description: "Analysis pack — 10,000 comments",
      },
    ]);
  });
});

describe("diff", () => {
  const desired = [
    { plan_key: "creator", interval: "month", amount: "1200" },
    { plan_key: "creator", interval: "year", amount: "12000" },
    { plan_key: "pack_10k", interval: "pack", amount: "500" },
  ];
  const match = (d: { plan_key: string; interval?: string }) =>
    [d.plan_key, d.interval ?? ""].join(":");
  it("creates everything on an empty account", () => {
    const d = diff([], desired, match);
    expect(d.create).toEqual(desired);
    expect(d.found).toEqual([]);
    expect(d.drift).toEqual([]);
  });
  it("creates nothing on the second run: every row is found by its custom_data", () => {
    const existing = [
      {
        id: "pri_1",
        custom_data: { plan_key: "creator", interval: "month" },
        unit_price: { amount: "1200" },
      },
      {
        id: "pri_2",
        custom_data: { plan_key: "creator", interval: "year" },
        unit_price: { amount: "12000" },
      },
      {
        id: "pri_3",
        custom_data: { plan_key: "pack_10k", interval: "pack" },
        unit_price: { amount: "500" },
      },
      // A price nobody in the table asked for is left alone, not deleted.
      {
        id: "pri_9",
        custom_data: { plan_key: "legacy", interval: "month" },
        unit_price: { amount: "1" },
      },
    ];
    const d = diff(existing, desired, match, (e) => e.unit_price.amount);
    expect(d.create).toEqual([]);
    expect(
      d.found.map((f) => [
        f.desired.plan_key,
        f.desired.interval,
        f.existing.id,
      ]),
    ).toEqual([
      ["creator", "month", "pri_1"],
      ["creator", "year", "pri_2"],
      ["pack_10k", "pack", "pri_3"],
    ]);
    expect(d.drift).toEqual([]);
  });
  it("reports a price whose amount no longer matches the table as drift, still found", () => {
    const existing = [
      {
        id: "pri_1",
        custom_data: { plan_key: "creator", interval: "month" },
        unit_price: { amount: "1000" },
      },
    ];
    const d = diff(existing, desired, match, (e) => e.unit_price.amount);
    expect(d.create.map(match)).toEqual(["creator:year", "pack_10k:pack"]);
    expect(d.found.map((f) => f.existing.id)).toEqual(["pri_1"]);
    expect(d.drift).toEqual([
      {
        desired: desired[0],
        existing: existing[0],
        have: "1000",
        want: "1200",
      },
    ]);
  });
  it("ignores an entity without custom_data and matches products by plan_key alone", () => {
    const products = [
      { id: "pro_0", name: "Hand-made", custom_data: null },
      { id: "pro_1", name: "Creator", custom_data: { plan_key: "creator" } },
    ];
    const d = diff(
      products,
      [{ plan_key: "creator" }, { plan_key: "agency" }],
      (x) => x.plan_key,
    );
    expect(d.found.map((f) => f.existing.id)).toEqual(["pro_1"]);
    expect(d.create).toEqual([{ plan_key: "agency" }]);
  });
});

describe("Paddle bodies", () => {
  it("builds a product with the plan key in custom_data", () => {
    expect(
      productBody({ plan_key: "creator", name: "Creator", kind: "plan" }),
    ).toEqual({
      name: "Creator",
      tax_category: "saas",
      custom_data: { plan_key: "creator" },
    });
  });
  it("builds a recurring price for a plan interval", () => {
    expect(
      priceBody(
        {
          plan_key: "creator",
          interval: "year",
          amount: "12000",
          description: "Creator — yearly",
        },
        "pro_1",
      ),
    ).toEqual({
      product_id: "pro_1",
      name: "Creator — yearly",
      description: "Creator — yearly",
      unit_price: { amount: "12000", currency_code: "USD" },
      billing_cycle: { interval: "year", frequency: 1 },
      quantity: { minimum: 1, maximum: 1 },
      custom_data: { plan_key: "creator", interval: "year" },
    });
  });
  it("builds a one-time price for a pack, with no billing cycle", () => {
    const body = priceBody(
      {
        plan_key: "pack_10k",
        interval: "pack",
        amount: "500",
        description: "Analysis pack — 10,000 comments",
      },
      "pro_p",
    );
    expect(body).not.toHaveProperty("billing_cycle");
    expect(body).toMatchObject({
      product_id: "pro_p",
      unit_price: { amount: "500", currency_code: "USD" },
      custom_data: { plan_key: "pack_10k", interval: "pack" },
    });
  });
});

describe("providerPrices", () => {
  it("folds the prices of one key into the jsonb the table stores", () => {
    const prices = [
      { plan_key: "creator", interval: "month", id: "pri_1" },
      { plan_key: "creator", interval: "year", id: "pri_2" },
      { plan_key: "pack_10k", interval: "pack", id: "pri_3" },
    ];
    expect(providerPrices(prices, "creator")).toEqual({
      month: "pri_1",
      year: "pri_2",
    });
    expect(providerPrices(prices, "pack_10k")).toEqual({ pack: "pri_3" });
    expect(providerPrices(prices, "agency")).toEqual({});
  });
});

describe("summary", () => {
  it("says what was created and what was written, so a second run reads 0 created", () => {
    expect(
      summary({
        productsCreated: 0,
        pricesCreated: 0,
        rowsWritten: 4,
        drift: 0,
      }),
    ).toBe(
      "0 created, 4 updated (0 products, 0 prices created; 4 rows written; 0 drifted)",
    );
  });
});
