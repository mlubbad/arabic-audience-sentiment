import { describe, expect, it } from "vitest";
import {
  desiredPrices,
  diff,
  paddleBase,
  paddleClient,
  planProducts,
  priceBody,
  productBody,
  providerPrices,
  run,
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

// --- The calls, against a fetch that never leaves the process. ---

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("paddleClient", () => {
  it("follows meta.pagination.next while has_more and returns every page's items in order", async () => {
    const seen: string[] = [];
    const fetch: Fetch = async (url, init) => {
      seen.push(url);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer k",
        "Paddle-Version": "1",
      });
      if (url === "https://sandbox-api.paddle.com/products?status=active")
        return json({
          data: [{ id: "pro_1" }, { id: "pro_2" }],
          meta: {
            pagination: {
              has_more: true,
              next: "https://sandbox-api.paddle.com/products?status=active&after=pro_2",
            },
          },
        });
      if (url.endsWith("after=pro_2"))
        return json({
          data: [{ id: "pro_3" }],
          meta: { pagination: { has_more: false, next: null } },
        });
      throw new Error(`unexpected ${url}`);
    };
    const paddle = paddleClient({
      fetch,
      base: paddleBase("sandbox"),
      key: "k",
    });
    const all = await paddle.all("/products?status=active");
    expect(all.map((p) => p.id)).toEqual(["pro_1", "pro_2", "pro_3"]);
    expect(seen).toHaveLength(2);
  });
  it("stops after one page when has_more is false, even if next is set", async () => {
    const fetch: Fetch = async () =>
      json({
        data: [{ id: "pri_1" }],
        meta: { pagination: { has_more: false, next: "https://x/never" } },
      });
    const paddle = paddleClient({ fetch, base: paddleBase("live"), key: "k" });
    expect(await paddle.all("/prices")).toEqual([{ id: "pri_1" }]);
  });
  it("names the HTTP status when the error body is not JSON, and never the key", async () => {
    const fetch: Fetch = async () =>
      new Response("<html>bad gateway</html>", { status: 502 });
    const paddle = paddleClient({
      fetch,
      base: paddleBase("sandbox"),
      key: "secret_k",
    });
    await expect(paddle.call("GET", "/products")).rejects.toThrow(
      "Paddle GET /products → 502: no detail",
    );
    await expect(paddle.call("GET", "/products")).rejects.not.toThrow(
      "secret_k",
    );
  });
  it("names Paddle's detail when the error body carries one", async () => {
    const fetch: Fetch = async () =>
      json(
        {
          error: {
            code: "validation",
            detail: "unit_price.amount is required",
          },
        },
        400,
      );
    const paddle = paddleClient({
      fetch,
      base: paddleBase("sandbox"),
      key: "k",
    });
    await expect(paddle.call("POST", "/prices", {})).rejects.toThrow(
      "Paddle POST /prices → 400: unit_price.amount is required",
    );
  });
  it("uses the live host for live and the sandbox host otherwise", () => {
    expect(paddleBase("live")).toBe("https://api.paddle.com");
    expect(paddleBase("sandbox")).toBe("https://sandbox-api.paddle.com");
  });
});

/** An in-memory Paddle and Supabase: two-item pages so a run must paginate,
 *  the same auth checks the real ones make, and the tables as rows. */
function fakeWorld() {
  const plansRows = plans.map((p) => ({
    ...p,
    provider_prices: {} as Record<string, string>,
  }));
  const addonRows = addons.map((a) => ({
    ...a,
    provider_prices: {} as Record<string, string>,
  }));
  const products: { id: string; custom_data: Record<string, string> }[] = [];
  const prices: {
    id: string;
    custom_data: Record<string, string>;
    billing_cycle?: unknown;
    unit_price: { amount: string };
  }[] = [];
  const calls: string[] = [];
  let n = 0;
  const fetch: Fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = init.headers as Record<string, string>;
    calls.push(`${method} ${u.host}${u.pathname}`);
    const isPaddle = u.host.endsWith("paddle.com");
    const key = isPaddle ? "pdl_fake" : "svc_fake";
    if (headers.Authorization !== `Bearer ${key}`)
      return json({ error: { code: "forbidden" } }, 403);
    if (isPaddle) {
      if (headers["Paddle-Version"] !== "1")
        return json({ error: { code: "version" } }, 400);
      const page = (all: { id: string }[]) => {
        const after = u.searchParams.get("after");
        const start = after ? all.findIndex((x) => x.id === after) + 1 : 0;
        const data = all.slice(start, start + 2);
        const has_more = start + 2 < all.length;
        const next = has_more
          ? `https://sandbox-api.paddle.com${u.pathname}?status=active&per_page=200&after=${data[data.length - 1].id}`
          : null;
        return json({ data, meta: { pagination: { has_more, next } } });
      };
      if (method === "GET" && u.pathname === "/products") return page(products);
      if (method === "GET" && u.pathname === "/prices") return page(prices);
      const body = JSON.parse(String(init.body));
      if (method === "POST" && u.pathname === "/products") {
        const p = { id: `pro_${++n}`, ...body };
        products.push(p);
        return json({ data: p }, 201);
      }
      if (method === "POST" && u.pathname === "/prices") {
        const p = { id: `pri_${++n}`, ...body };
        prices.push(p);
        return json({ data: p }, 201);
      }
      return json({ error: { code: "not_found" } }, 404);
    }
    if (method === "GET" && u.pathname === "/rest/v1/plans")
      return json(plansRows);
    if (method === "GET" && u.pathname === "/rest/v1/addon_prices")
      return json(addonRows);
    if (method === "PATCH") {
      if (headers.Prefer !== "return=minimal")
        return new Response("prefer", { status: 400 });
      const key = (u.searchParams.get("key") ?? "").replace("eq.", "");
      const table = u.pathname.endsWith("/plans") ? plansRows : addonRows;
      const row = table.find((r) => r.key === key);
      if (!row) return new Response("no row", { status: 404 });
      row.provider_prices = JSON.parse(String(init.body)).provider_prices;
      return new Response(null, { status: 204 });
    }
    return new Response("nope", { status: 404 });
  };
  const runOnce = (dryRun = false) => {
    const before = calls.length;
    return run({
      fetch,
      paddleEnv: "sandbox",
      apiKey: "pdl_fake",
      supabaseUrl: "https://fake.supabase.local/",
      serviceKey: "svc_fake",
      dryRun,
    }).then((result) => ({ result, calls: calls.slice(before) }));
  };
  return { plansRows, addonRows, products, prices, runOnce };
}

describe("run", () => {
  it("creates every product and price once, then a second run creates nothing and reports 0 created, 4 updated", async () => {
    const world = fakeWorld();
    const first = await world.runOnce();
    expect(first.result.line).toBe(
      "11 created, 4 updated (4 products, 7 prices created; 4 rows written; 0 drifted)",
    );
    expect(world.products.map((p) => p.custom_data.plan_key)).toEqual([
      "creator",
      "creator_plus",
      "agency",
      "pack_10k",
    ]);
    expect(world.prices).toHaveLength(7);
    expect(
      world.prices.filter((p) => !p.billing_cycle).map((p) => p.custom_data),
    ).toEqual([{ plan_key: "pack_10k", interval: "pack" }]);
    const ids = (k: string) =>
      world.plansRows.find((p) => p.key === k)!.provider_prices;
    expect(Object.keys(ids("creator")).sort()).toEqual(["month", "year"]);
    expect(Object.keys(ids("agency")).sort()).toEqual(["month", "year"]);
    expect(ids("free")).toEqual({});
    expect(ids("media")).toEqual({});
    expect(Object.keys(world.addonRows[0].provider_prices)).toEqual(["pack"]);

    const second = await world.runOnce();
    expect(second.result.line).toBe(
      "0 created, 4 updated (0 products, 0 prices created; 4 rows written; 0 drifted)",
    );
    expect(second.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    // Every list was paginated: seven prices are four pages of two.
    expect(
      second.calls.filter((c) => c === "GET sandbox-api.paddle.com/prices"),
    ).toHaveLength(4);
    expect(world.products).toHaveLength(4);
    expect(world.prices).toHaveLength(7);
  });
  it("in a dry run reads both sides and writes nothing anywhere", async () => {
    const world = fakeWorld();
    const { result, calls } = await world.runOnce(true);
    expect(result.line).toBe(
      "0 created, 0 updated (0 products, 0 prices created; 0 rows written; 0 drifted)",
    );
    expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
    expect(world.products).toEqual([]);
    expect(
      world.plansRows.find((p) => p.key === "creator")!.provider_prices,
    ).toEqual({});
  });
  it("reports drift on a rerun after the table's price changed, and still writes the id", async () => {
    const world = fakeWorld();
    await world.runOnce();
    world.plansRows.find((p) => p.key === "creator")!.price_monthly_cents =
      1500;
    const { result, calls } = await world.runOnce();
    expect(result.drift).toBe(1);
    expect(result.line).toBe(
      "0 created, 4 updated (0 products, 0 prices created; 4 rows written; 1 drifted)",
    );
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect(
      world.prices.find(
        (p) =>
          p.custom_data.plan_key === "creator" &&
          p.custom_data.interval === "month",
      )!.unit_price.amount,
    ).toBe("1200");
  });
});
