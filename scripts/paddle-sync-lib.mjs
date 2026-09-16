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
 *
 * The calls live here too, with `fetch` injected, so the whole run — both
 * pages of a Paddle list, a refused request, the second run that creates
 * nothing — is driven by the test against an in-memory Paddle and Supabase.
 * `paddle-sync-prices.mjs` only reads the environment and calls `run`.
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

/** Where Paddle answers for an environment. */
export const paddleBase = (paddleEnv) =>
  paddleEnv === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

/** Paddle's API: `call` is one request, `all` is every page of a list,
 *  following `meta.pagination.next` while `has_more`. A failure names the
 *  status and Paddle's detail — never the key — and a body that is not JSON
 *  still names the status. */
export function paddleClient({ fetch, base, key }) {
  async function call(method, path, body) {
    const res = await fetch(path.startsWith("http") ? path : base + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Paddle-Version": "1",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `Paddle ${method} ${path} → ${res.status}: ${json?.error?.detail ?? json?.error?.code ?? "no detail"}`,
      );
    return json;
  }
  async function all(path) {
    const out = [];
    let next = path;
    while (next) {
      const page = await call("GET", next);
      out.push(...(page.data ?? []));
      next = page.meta?.pagination?.has_more ? page.meta.pagination.next : null;
    }
    return out;
  }
  return { call, all };
}

/** Supabase's REST endpoint with the service role: the two reads and the
 *  writes of provider_prices. `return=minimal` on a write: nothing to read. */
export function supabaseRest({ fetch, url, key }) {
  const root = url.replace(/\/+$/, "");
  return async function rest(method, path, body) {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (method !== "GET") headers.Prefer = "return=minimal";
    const res = await fetch(`${root}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
      throw new Error(
        `Supabase ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    return method === "GET" ? res.json() : null;
  };
}

/** One run: read the tables, find or create in Paddle, write the ids back.
 *  Returns the counts the summary line is made of; `dryRun` reads both
 *  sides and writes nothing. */
export async function run({
  fetch,
  paddleEnv,
  apiKey,
  supabaseUrl,
  serviceKey,
  dryRun = false,
  log = () => {},
  warn = log,
}) {
  const paddle = paddleClient({
    fetch,
    base: paddleBase(paddleEnv),
    key: apiKey,
  });
  const rest = supabaseRest({ fetch, url: supabaseUrl, key: serviceKey });

  const plans = await rest(
    "GET",
    "plans?select=key,price_monthly_cents,price_yearly_cents,self_serve,internal,title_en,provider_prices&order=sort_order",
  );
  const addons = await rest(
    "GET",
    "addon_prices?select=key,kind,units,price_cents,provider_prices&order=key",
  );
  const wanted = planProducts(plans, addons);
  log(
    `${paddleEnv}: ${plans.length} plans, ${addons.length} packs read; ${wanted.length} products wanted${dryRun ? " (dry run)" : ""}.`,
  );

  // Products: found by custom_data.plan_key, created when missing.
  const existingProducts = await paddle.all(
    "/products?status=active&per_page=200",
  );
  const products = diff(existingProducts, wanted, productKey);
  const productId = new Map(
    products.found.map((f) => [f.desired.plan_key, f.existing.id]),
  );
  for (const p of products.create) {
    if (dryRun) {
      log(`would create product ${p.plan_key} (${p.name})`);
      continue;
    }
    const created = await paddle.call("POST", "/products", productBody(p));
    productId.set(p.plan_key, created.data.id);
    log(`created product ${p.plan_key} → ${created.data.id}`);
  }
  for (const f of products.found)
    log(`found product ${f.desired.plan_key} → ${f.existing.id}`);

  // Prices: found by plan_key:interval; created against the product's id.
  const existingPrices = await paddle.all("/prices?status=active&per_page=200");
  const wantedPrices = wanted.flatMap(desiredPrices);
  const prices = diff(
    existingPrices,
    wantedPrices,
    priceKey,
    (e) => e.unit_price?.amount,
  );
  const synced = prices.found.map((f) => ({ ...f.desired, id: f.existing.id }));
  for (const d of prices.drift)
    warn(
      `drift: ${priceKey(d.desired)} is ${d.have} in Paddle, ${d.want} in the table — id written, price left as is`,
    );
  for (const p of prices.create) {
    const pid = productId.get(p.plan_key);
    if (dryRun || !pid) {
      log(`would create price ${priceKey(p)} (${p.amount} USD cents)`);
      continue;
    }
    const created = await paddle.call("POST", "/prices", priceBody(p, pid));
    synced.push({ ...p, id: created.data.id });
    log(`created price ${priceKey(p)} → ${created.data.id}`);
  }

  // The ids go back to the tables, one row per key, only when every price
  // of that key is known — a half-written {month} would let checkout open
  // one interval and refuse the other.
  let rowsWritten = 0;
  for (const p of wanted) {
    const map = providerPrices(synced, p.plan_key);
    const complete = desiredPrices(p).every((d) => map[d.interval]);
    if (!complete) {
      log(`${p.plan_key}: prices incomplete, row not written`);
      continue;
    }
    const table = p.kind === "pack" ? "addon_prices" : "plans";
    if (dryRun) {
      log(`would write ${table}.${p.plan_key} ← ${JSON.stringify(map)}`);
      continue;
    }
    await rest("PATCH", `${table}?key=eq.${encodeURIComponent(p.plan_key)}`, {
      provider_prices: map,
    });
    rowsWritten += 1;
    log(`wrote ${table}.${p.plan_key} ← ${JSON.stringify(map)}`);
  }

  const counts = {
    productsCreated: dryRun ? 0 : products.create.length,
    pricesCreated: dryRun ? 0 : prices.create.length,
    rowsWritten,
    drift: prices.drift.length,
  };
  return { ...counts, line: summary(counts) };
}
