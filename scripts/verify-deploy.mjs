#!/usr/bin/env node
/**
 * After the FTPS upload, prove the public hostname serves the build that was
 * just uploaded.
 *
 * Why this exists: on 2026-10-02 four consecutive deploys (#95-#98) uploaded
 * every file with FTP 226 and reported success, while app.sky-develop.net kept
 * serving an older build from a different document root. Nothing failed, so
 * nothing told anyone; a production OAuth flow broke against the stale
 * frontend instead. An upload proves the bytes reached the FTP account, not
 * that the site serves them.
 *
 * The check: the entry script named in the freshly built `dist/app.html` (the
 * template every app route falls back to) must be the one the live `/account`
 * page names, and that file must answer 200. Hashed names make this exact:
 * a different build cannot carry the same entry name.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY =
  /<script\b[^>]*\btype="module"[^>]*\bsrc="(\/static\/index-[^"]+\.js)"/;

/** The entry script path a built or served HTML document loads, or null. */
export function entryScript(html) {
  return ENTRY.exec(html)?.[1] ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves with the verified entry path, or rejects with a message naming
 * both entry names. Hashed asset names are public, never secrets.
 */
export async function verifyDeploy({
  expected,
  baseUrl,
  sha = "",
  fetchImpl = fetch,
  attempts = 6,
  delayMs = 10_000,
}) {
  if (!expected)
    throw new Error("built app.html names no /static/index-*.js entry");
  const page = new URL("/account", baseUrl);
  // A query unique to this deploy keeps any cache between here and the origin
  // from answering with a copy it already held.
  page.searchParams.set("deploy-check", sha || String(Date.now()));

  let last = "no response";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(page, {
        headers: { "cache-control": "no-cache" },
        redirect: "follow",
      });
      if (!response.ok) {
        last = `${page.pathname} answered ${response.status}`;
      } else {
        const live = entryScript(await response.text());
        if (live === expected) {
          const asset = await fetchImpl(new URL(expected, baseUrl), {
            method: "HEAD",
          });
          if (asset.ok) return expected;
          last = `${expected} answered ${asset.status}`;
        } else {
          last = `live site loads ${live ?? "no /static/index-*.js entry"}, this build is ${expected}`;
        }
      }
    } catch (error) {
      last = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(
    `${new URL(baseUrl).host} is not serving this deploy (${last}). ` +
      "The upload succeeded, so the FTP account's document root is not the one " +
      "the hostname serves: compare PREVIEW_FTP_* with the domain's document root.",
  );
}

async function main() {
  const baseUrl =
    process.env.DEPLOY_VERIFY_URL || "https://app.sky-develop.net";
  const expected = entryScript(
    readFileSync(join("apps", "web", "dist", "app.html"), "utf8"),
  );
  const verified = await verifyDeploy({
    expected,
    baseUrl,
    sha: process.env.TARGET_SHA ?? "",
  });
  console.log(`${new URL(baseUrl).host} serves ${verified}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
