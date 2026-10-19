#!/usr/bin/env node
/**
 * Deploy every Supabase Edge Function whose code on main is newer than what
 * production runs, then prove production now runs main.
 *
 * Why this exists: functions were deployed only by hand. On 2026-10-19 the
 * production `worker` was v35 from 2026-10-16 while main had changed it five
 * times since, so every YouTube discover ended
 * `partial channel_profile_commit_failed` for two days. Six other functions
 * were older than main too. ADR 0004 moves the deploy into deploy.yml.
 *
 * Stale, not "changed in this push": a function is redeployed when the last
 * commit on main's first-parent line touching its folder, `_shared/` or the
 * Deno config is newer than the function's `updated_at` in production. A run
 * that fails, or a merge whose deploy never ran, is therefore made good by the
 * next run instead of being forgotten.
 *
 * `verify_jwt` is declared for every function in supabase/config.toml and must
 * equal production before anything is deployed. A deploy without
 * `--no-verify-jwt` turns the gateway's JWT check on, which would lock the
 * worker and the OAuth redirects out; one with it turns the check off for a
 * function that relies on it. Either flip is the owner's decision, so a
 * mismatch stops the run instead of being "fixed" by it.
 *
 * Modes:
 *   (default)   deploy what is stale, then verify every function
 *   --dry-run   print the plan, deploy nothing, exit 0 unless the plan is refused
 *   --check     print the plan, deploy nothing, exit 1 if anything is stale
 *
 * The access token is read from SUPABASE_ACCESS_TOKEN and handed to the CLI
 * through its environment, never through argv, and is never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv, requireProjectRef } from "./apply-migrations-remote.mjs";

export const FUNCTIONS_DIR = "supabase/functions";
const CONFIG = "supabase/config.toml";
/** Paths every function bundles besides its own folder. */
export const SHARED_PATHS = [
  `${FUNCTIONS_DIR}/_shared`,
  `${FUNCTIONS_DIR}/deno.json`,
  `${FUNCTIONS_DIR}/deno.lock`,
];

/** Deployable function names: folders under supabase/functions with an index.ts, `_*` excluded. */
export function localFunctions(dir = FUNCTIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith("_") &&
        existsSync(join(dir, entry.name, "index.ts")),
    )
    .map((entry) => entry.name)
    .sort();
}

/** `[functions.NAME] verify_jwt = true|false` pairs from config.toml. */
export function declaredVerifyJwt(toml) {
  const declared = new Map();
  let current = null;
  for (const raw of toml.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const match = /^functions\.([a-z0-9-]+)$/.exec(section[1].trim());
      current = match ? match[1] : null;
      continue;
    }
    const setting = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (current && setting) declared.set(current, setting[1] === "true");
  }
  return declared;
}

/**
 * Decide what to deploy.
 *
 * functions:  local function names
 * declared:   Map name -> verify_jwt from config.toml
 * live:       Map name -> production function object, absent when not deployed
 * lastChange: Map name -> { sha, at } (at in ms) of the newest main commit touching it
 */
export function planDeploy({ functions, declared, live, lastChange }) {
  const refused = [];
  const rows = [];
  for (const name of functions) {
    const jwt = declared.get(name);
    const remote = live.get(name) ?? null;
    const change = lastChange.get(name) ?? null;
    if (jwt === undefined) {
      refused.push(
        `${name}: no [functions.${name}] verify_jwt in ${CONFIG}; declare what production should run`,
      );
    } else if (remote && remote.verify_jwt !== jwt) {
      refused.push(
        `${name}: ${CONFIG} says verify_jwt = ${jwt}, production runs ${remote.verify_jwt}; the owner decides a JWT change and deploys it by hand`,
      );
    }
    if (!change) {
      refused.push(`${name}: no commit on main touches it`);
      continue;
    }
    const stale = !remote || remote.updated_at < change.at;
    rows.push({ name, verifyJwt: jwt, remote, change, stale });
  }
  const unknown = [...live.keys()].filter((name) => !functions.includes(name));
  return {
    refused,
    rows,
    stale: rows.filter((row) => row.stale).map((row) => row.name),
    unknown,
  };
}

/** The CLI arguments for one function; the token travels in the environment. */
export function deployArgs(name, projectRef, verifyJwt) {
  const args = [
    "--no-install",
    "supabase",
    "functions",
    "deploy",
    name,
    "--project-ref",
    projectRef,
    // Bundled by Supabase, not by an edge-runtime container the CLI would pull
    // by tag: no unpinned image, and no Docker needed on the runner.
    "--use-api",
  ];
  if (verifyJwt === false) args.push("--no-verify-jwt");
  return args;
}

/** Problems with one deployed function after the deploy, empty when it landed. */
export function deployedProblems(name, before, after, verifyJwt) {
  if (!after) return [`${name}: not found in production after the deploy`];
  const problems = [];
  if (before && !(after.updated_at > before.updated_at))
    problems.push(
      `${name}: updated_at did not move (${iso(before.updated_at)} -> ${iso(after.updated_at)})`,
    );
  if (after.status !== "ACTIVE")
    problems.push(`${name}: status ${after.status}`);
  if (after.verify_jwt !== verifyJwt)
    problems.push(
      `${name}: verify_jwt ${after.verify_jwt}, expected ${verifyJwt}`,
    );
  return problems;
}

const iso = (ms) => (ms == null ? "—" : new Date(ms).toISOString());

export function formatPlan(plan) {
  const lines = plan.rows.map((row) =>
    [
      row.stale ? "DEPLOY" : "ok    ",
      row.name.padEnd(16),
      `verify_jwt=${row.verifyJwt}`,
      `live v${row.remote?.version ?? "—"} ${iso(row.remote?.updated_at)}`,
      `main ${row.change.sha.slice(0, 7)} ${iso(row.change.at)}`,
    ].join("  "),
  );
  for (const name of plan.unknown)
    lines.push(`note    ${name} runs in production but has no folder on main`);
  return lines.join("\n");
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Newest first-parent commit at `ref` touching the function or what it bundles. */
export function lastChangeOnMain(name, ref) {
  const out = git([
    "log",
    "-1",
    "--first-parent",
    "--format=%H %ct",
    ref,
    "--",
    `${FUNCTIONS_DIR}/${name}`,
    ...SHARED_PATHS,
  ]);
  if (!out) return null;
  const [sha, seconds] = out.split(" ");
  return { sha, at: Number(seconds) * 1000 };
}

export function managementApi(token, projectRef, fetchImpl = fetch) {
  const base = `https://api.supabase.com/v1/projects/${projectRef}/functions`;
  const call = async (path) => {
    const res = await fetchImpl(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok)
      throw new Error(
        `GET functions${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    return res.json();
  };
  return {
    async list() {
      const all = (await call("")) ?? [];
      return new Map(all.map((fn) => [fn.slug, fn]));
    },
    get: (slug) => call(`/${encodeURIComponent(slug)}`),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv) {
  const mode = argv.includes("--check")
    ? "check"
    : argv.includes("--dry-run")
      ? "dry-run"
      : "deploy";
  const refArg = argv.find((arg) => arg.startsWith("--ref="));
  const ref = refArg ? refArg.slice(6) : process.env.TARGET_SHA || "HEAD";

  loadLocalEnv();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const projectRef = requireProjectRef();
  const api = managementApi(token, projectRef);

  const functions = localFunctions();
  const declared = declaredVerifyJwt(readFileSync(CONFIG, "utf8"));
  const lastChange = new Map(
    functions.map((name) => [name, lastChangeOnMain(name, ref)]),
  );
  const live = await api.list();
  const plan = planDeploy({ functions, declared, live, lastChange });

  console.log(`Edge functions at ${ref} against production:`);
  console.log(formatPlan(plan));
  if (plan.refused.length) {
    console.error(`\nRefused, nothing deployed:\n${plan.refused.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  if (mode === "check") {
    if (plan.stale.length) {
      console.error(
        `\nProduction runs older code than main for: ${plan.stale.join(", ")}`,
      );
      process.exitCode = 1;
    } else
      console.log("\nEvery function in production is at least as new as main.");
    return;
  }
  if (mode === "dry-run") {
    console.log(
      `\nDry run: would deploy ${plan.stale.length ? plan.stale.join(", ") : "nothing"}.`,
    );
    return;
  }

  const version = spawnSync("npx", ["--no-install", "supabase", "--version"], {
    encoding: "utf8",
  });
  console.log(`\nSupabase CLI ${version.stdout.trim()}`);

  const problems = [];
  for (const name of plan.stale) {
    const verifyJwt = declared.get(name);
    console.log(`\n::group::Deploy ${name} (verify_jwt=${verifyJwt})`);
    const result = spawnSync("npx", deployArgs(name, projectRef, verifyJwt), {
      stdio: "inherit",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    });
    console.log("::endgroup::");
    if (result.status !== 0) {
      problems.push(
        `${name}: the CLI exited ${result.status ?? result.signal}`,
      );
      continue;
    }
    const before = live.get(name) ?? null;
    let found = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      found = deployedProblems(name, before, await api.get(name), verifyJwt);
      if (!found.length) break;
      await sleep(3000);
    }
    problems.push(...found);
  }

  // The whole set, not only what was deployed: nothing may stay older than main.
  const after = planDeploy({
    functions,
    declared,
    live: await api.list(),
    lastChange,
  });
  problems.push(...after.refused);
  for (const name of after.stale)
    problems.push(`${name}: production is still older than main`);

  console.log(`\nAfter the deploy:\n${formatPlan(after)}`);
  if (problems.length) {
    console.error(`\nEdge function deploy failed:\n${problems.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nDeployed ${plan.stale.length ? plan.stale.join(", ") : "nothing (all current)"}; production matches main.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("Edge function deploy error:", err.message);
    process.exitCode = 1;
  });
}
