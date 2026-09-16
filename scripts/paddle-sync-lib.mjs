/**
 * What Paddle should hold, decided from the tables — the pure half of
 * `paddle-sync-prices.mjs`, tested in `paddle-sync-lib.test.ts`.
 *
 * The plans table is the source of truth for prices (docs/pricing-v2-draft.md
 * §2); Paddle is told about them, never the other way round. Every product
 * and price Paddle holds for this app carries `custom_data.plan_key` (and
 * `custom_data.interval` on a price: month, year or pack), and that is what a
 * run matches on. So a second run finds everything and creates nothing; a
 * product or price somebody made by hand, with no custom_data, is neither
 * matched nor touched.
 *
 * A price whose amount in Paddle no longer equals the table's is *drift*: it
 * is reported and its id is still written, because a Paddle price with
 * subscribers on it is not something a sync script should change under them.
 * The person reading the report decides.
 */

/** @typedef {{ plan_key: string, name: string, kind: "plan" | "pack", monthly?: number, yearly?: number, cents?: number }} Product */
/** @typedef {{ plan_key: string, interval: "month" | "year" | "pack", amount: string, description: string }} Price */

const CURRENCY = "USD";

/** The products wanted: one per self-serve plan priced above zero (free has
 *  nothing to sell, media and enterprise are sold by hand, internal rows are
 *  not for sale), then one per pack. Order follows the rows given. */
export function planProducts(plans, addons = []) {
  const forPlans = plans
    .filter((p) => p.self_serve && !p.internal && p.price_monthly_cents > 0)
    .map((p) => ({
      plan_key: p.key,
      name: p.title_en,
      kind: "plan",
      monthly: p.price_monthly_cents,
      yearly: p.price_yearly_cents,
    }));
  const forPacks = addons.map((a) => ({
    plan_key: a.key,
    name: packName(a),
    kind: "pack",
    cents: a.price_cents,
  }));
  return [...forPlans, ...forPacks];
}

const KIND_WORDS = {
  comment_analysis: "comments",
  historical_backfill: "backfill comments",
  topic_classification: "topic classifications",
};

/** "Analysis pack — 10,000 comments": what the buyer sees on Paddle's overlay. */
export function packName(addon) {
  const what = KIND_WORDS[addon.kind] ?? addon.kind;
  return `Analysis pack — ${addon.units.toLocaleString("en-US")} ${what}`;
}

/** The prices wanted for one product: monthly and yearly for a plan, one
 *  one-time price for a pack. Amounts are cents as Paddle spells them. */
export function desiredPrices(product) {
  if (product.kind === "pack")
    return [
      {
        plan_key: product.plan_key,
        interval: "pack",
        amount: String(product.cents),
        description: product.name,
      },
    ];
  return [
    {
      plan_key: product.plan_key,
      interval: "month",
      amount: String(product.monthly),
      description: `${product.name} — monthly`,
    },
    {
      plan_key: product.plan_key,
      interval: "year",
      amount: String(product.yearly),
      description: `${product.name} — yearly`,
    },
  ];
}

/** Matches what exists in Paddle against what the table wants, by the key
 *  `by` derives from `custom_data` (an entity without custom_data cannot
 *  match). `value` reads the one field that may drift — a price's amount —
 *  and is absent for products, which have nothing to compare. */
export function diff(existing, desired, by, value = null) {
  const have = new Map();
  for (const e of existing) {
    if (!e.custom_data || typeof e.custom_data !== "object") continue;
    const k = by(e.custom_data);
    if (!have.has(k)) have.set(k, e);
  }
  const create = [];
  const found = [];
  const drift = [];
  for (const d of desired) {
    const e = have.get(by(d));
    if (!e) {
      create.push(d);
      continue;
    }
    found.push({ desired: d, existing: e });
    if (value) {
      const got = value(e);
      if (got !== d.amount)
        drift.push({ desired: d, existing: e, have: got, want: d.amount });
    }
  }
  return { create, found, drift };
}

export const productKey = (x) => x.plan_key;
export const priceKey = (x) => `${x.plan_key}:${x.interval ?? ""}`;

/** POST /products */
export function productBody(product) {
  return {
    name: product.name,
    tax_category: "saas",
    custom_data: { plan_key: product.plan_key },
  };
}

/** POST /prices — recurring for a plan interval, one-time for a pack. */
export function priceBody(price, productId) {
  const body = {
    product_id: productId,
    name: price.description,
    description: price.description,
    unit_price: { amount: price.amount, currency_code: CURRENCY },
    quantity: { minimum: 1, maximum: 1 },
    custom_data: { plan_key: price.plan_key, interval: price.interval },
  };
  if (price.interval !== "pack")
    body.billing_cycle = { interval: price.interval, frequency: 1 };
  return body;
}

/** The jsonb one row stores: {month, year} for a plan, {pack} for a pack. */
export function providerPrices(prices, planKey) {
  const out = {};
  for (const p of prices) if (p.plan_key === planKey) out[p.interval] = p.id;
  return out;
}

/** One line a person reads at the end: "0 created, N updated" on a clean rerun. */
export function summary({
  productsCreated,
  pricesCreated,
  rowsWritten,
  drift,
}) {
  const created = productsCreated + pricesCreated;
  return `${created} created, ${rowsWritten} updated (${productsCreated} products, ${pricesCreated} prices created; ${rowsWritten} rows written; ${drift} drifted)`;
}
