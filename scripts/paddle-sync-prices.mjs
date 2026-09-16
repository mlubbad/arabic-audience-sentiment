#!/usr/bin/env node
/**
 * Prices live in Paddle but are written from the plans table.
 *
 * Reads every plan and pack from Supabase, makes sure Paddle holds one product
 * per self-serve paid plan (and per pack) and the prices each needs, then
 * writes the price ids back into `plans.provider_prices` ({month, year}) and
 * `addon_prices.provider_prices` ({pack}) — the jsonb `plan_key_for_price`
 * (20260917050000) resolves a webhook's price against and the checkout
 * (`apps/web/src/paddle.ts`) opens on. The run itself is `run` in
 * `paddle-sync-lib.mjs`, tested there against an in-memory Paddle and
 * Supabase; this file reads the environment and hands it `fetch`.
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
import { run } from "./paddle-sync-lib.mjs";

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

run({
  fetch: globalThis.fetch,
  paddleEnv,
  apiKey: env("PADDLE_API_KEY"),
  supabaseUrl: env("SUPABASE_URL"),
  serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  dryRun: process.argv.includes("--dry-run"),
  log: console.log,
  warn: console.warn,
})
  .then((result) => console.log(result.line))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
