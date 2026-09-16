#!/usr/bin/env node
/**
 * Prices live in Paddle but are written from the plans table.
 *
 * Reads every plan and pack from Supabase, makes sure Paddle holds one product
 * per self-serve paid plan (and per pack) and the prices each needs, then
 * writes the price ids back into `plans.provider_prices` ({month, year}) and
 * `addon_prices.provider_prices` ({pack}) — the jsonb `plan_key_for_price`
 * (20260917050000) resolves a webhook's price against and the checkout
 * (`apps/web/src/paddle.ts`) opens on. What to create is decided in
 * `paddle-sync-lib.mjs`; this file is the calls.
 *
 * Idempotent: products and prices are found by `custom_data.plan_key` (and
 * `interval`), so a second run creates nothing and reports "0 created,
 * N updated". Node 22, `fetch`, no dependency.
 *
 *   node --env-file=.env.local scripts/paddle-sync-prices.mjs [--dry-run]
 *
 * Environment: PADDLE_ENV (sandbox | live; sandbox unless said), PADDLE_API_KEY,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. None of them is ever printed.
 * `--dry-run` reads both sides and reports what a run would do, writing nothing.
 */
import {
  desiredPrices,
  diff,
  planProducts,
  priceBody,
  priceKey,
  productBody,
  productKey,
  providerPrices,
  summary,
} from "./paddle-sync-lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (!v) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
  return v;
};
const paddleEnv = env("PADDLE_ENV", "sandbox");
if (paddleEnv !== "sandbox" && paddleEnv !== "live") {
  console.error(`PADDLE_ENV must be sandbox or live, not ${paddleEnv}.`);
  process.exit(2);
}
const apiKey = env("PADDLE_API_KEY");
const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const paddleBase =
  paddleEnv === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

/** A Paddle call; a failure names the status and Paddle's message, never the key. */
async function paddle(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : paddleBase + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

/** Every page of a Paddle list, following meta.pagination.next. */
async function paddleAll(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await paddle("GET", next);
    out.push(...(page.data ?? []));
    next = page.meta?.pagination?.has_more ? page.meta.pagination.next : null;
  }
  return out;
}

/** A Supabase REST call with the service role: reads and the two writes. */
async function rest(method, path, body) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  if (method !== "GET") headers.Prefer = "return=minimal";
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw new Error(
      `Supabase ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return method === "GET" ? res.json() : null;
}

async function main() {
  const plans = await rest(
    "GET",
    "plans?select=key,price_monthly_cents,price_yearly_cents,self_serve,internal,title_en,provider_prices&order=sort_order",
  );
  const addons = await rest(
    "GET",
    "addon_prices?select=key,kind,units,price_cents,provider_prices&order=key",
  );
  const wanted = planProducts(plans, addons);
  console.log(
    `${paddleEnv}: ${plans.length} plans, ${addons.length} packs read; ${wanted.length} products wanted${dryRun ? " (dry run)" : ""}.`,
  );

  // Products: found by custom_data.plan_key, created when missing.
  const existingProducts = await paddleAll(
    "/products?status=active&per_page=200",
  );
  const products = diff(existingProducts, wanted, productKey);
  const productId = new Map(
    products.found.map((f) => [f.desired.plan_key, f.existing.id]),
  );
  for (const p of products.create) {
    if (dryRun) {
      console.log(`would create product ${p.plan_key} (${p.name})`);
      continue;
    }
    const created = await paddle("POST", "/products", productBody(p));
    productId.set(p.plan_key, created.data.id);
    console.log(`created product ${p.plan_key} → ${created.data.id}`);
  }
  for (const f of products.found)
    console.log(`found product ${f.desired.plan_key} → ${f.existing.id}`);

  // Prices: found by plan_key:interval; created against the product's id.
  const existingPrices = await paddleAll("/prices?status=active&per_page=200");
  const wantedPrices = wanted.flatMap(desiredPrices);
  const prices = diff(
    existingPrices,
    wantedPrices,
    priceKey,
    (e) => e.unit_price?.amount,
  );
  const synced = prices.found.map((f) => ({ ...f.desired, id: f.existing.id }));
  for (const d of prices.drift)
    console.warn(
      `drift: ${priceKey(d.desired)} is ${d.have} in Paddle, ${d.want} in the table — id written, price left as is`,
    );
  for (const p of prices.create) {
    const pid = productId.get(p.plan_key);
    if (dryRun || !pid) {
      console.log(`would create price ${priceKey(p)} (${p.amount} USD cents)`);
      continue;
    }
    const created = await paddle("POST", "/prices", priceBody(p, pid));
    synced.push({ ...p, id: created.data.id });
    console.log(`created price ${priceKey(p)} → ${created.data.id}`);
  }

  // The ids go back to the tables, one row per key, only when every price
  // of that key is known — a half-written {month} would let checkout open
  // one interval and refuse the other.
  let rowsWritten = 0;
  for (const p of wanted) {
    const map = providerPrices(synced, p.plan_key);
    const complete = desiredPrices(p).every((d) => map[d.interval]);
    if (!complete) {
      console.log(`${p.plan_key}: prices incomplete, row not written`);
      continue;
    }
    const table = p.kind === "pack" ? "addon_prices" : "plans";
    if (dryRun) {
      console.log(
        `would write ${table}.${p.plan_key} ← ${JSON.stringify(map)}`,
      );
      continue;
    }
    await rest("PATCH", `${table}?key=eq.${encodeURIComponent(p.plan_key)}`, {
      provider_prices: map,
    });
    rowsWritten += 1;
    console.log(`wrote ${table}.${p.plan_key} ← ${JSON.stringify(map)}`);
  }

  console.log(
    summary({
      productsCreated: dryRun ? 0 : products.create.length,
      pricesCreated: dryRun ? 0 : prices.create.length,
      rowsWritten,
      drift: prices.drift.length,
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
