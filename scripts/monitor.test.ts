import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

// scripts/monitor.sh against a stand-in for Supabase on localhost. The
// platform it sees is healthy in every way the old monitor measured,
// including a prediction made a minute ago, so the freshness verdict comes
// from the per-channel counts alone (2026-10-16: the newest prediction was
// an hour old while 16 of 18 collected channels had stalled).
const SERVICE_KEY = "test-service-role-key-not-a-secret";
let server: Server;
let base = "";
let freshness = "";
let calls: string[] = [];
let stateDir = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    calls.push(`${req.method} ${url.split("?")[0]}`);
    const now = new Date().toISOString();
    if (url.startsWith("/worker/claim")) return res.writeHead(204).end();
    if (url.startsWith("/rest/v1/rpc/svc_monitor_channel_freshness"))
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(freshness);
    if (url.startsWith("/rest/v1/jobs"))
      return res.writeHead(200, { "content-range": "*/0" }).end("[]");
    if (url.startsWith("/rest/v1/worker_seen"))
      return res.writeHead(200).end(JSON.stringify([{ last_seen_at: now }]));
    if (url.startsWith("/rest/v1/sentiment_predictions"))
      return res.writeHead(200).end(JSON.stringify([{ predicted_at: now }]));
    if (url.startsWith("/rest/v1/workspaces"))
      return res.writeHead(200).end("[]");
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  calls = [];
  freshness = '{"collected": 2, "stale": 0, "never": 0}';
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  stateDir = mkdtempSync(join(tmpdir(), "monitor-state-"));
});

// Asynchronous on purpose: the stand-in server answers on this process's
// event loop, which a synchronous spawn would block.
async function monitor(env: Record<string, string> = {}) {
  const child = spawn("sh", ["scripts/monitor.sh"], {
    env: {
      PATH: process.env.PATH,
      MONITOR_ENV_FILE: "",
      MONITOR_STATE_DIR: stateDir,
      SUPABASE_URL: base,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      WORKER_API_BASE_URL: `${base}/worker`,
      WORKER_CREDENTIAL: "test-worker-credential",
      ...env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const status = await new Promise<number | null>((done) =>
    child.on("close", done),
  );
  const result = { stdout, stderr, status };
  const line = (check: string) =>
    result.stdout
      .split("\n")
      .find((l) => l.split(" ")[2] === check)
      ?.split(" ")
      .slice(1)
      .join(" ");
  return { ...result, line };
}

describe("the monitor's freshness check", () => {
  test("fails when a collected channel is stale, however fresh the newest prediction", async () => {
    freshness = '{"collected": 18, "stale": 16, "never": 7}';
    const run = await monitor();
    expect(run.line("freshness")).toBe(
      "FAIL freshness 16_of_18_collected_channels_stale_48h_7_never_collected",
    );
    expect(run.status).toBe(2);
    expect(calls).toContain("POST /rest/v1/rpc/svc_monitor_channel_freshness");
  });

  test("passes when every collected channel has collected in 48 hours", async () => {
    const run = await monitor();
    expect(run.line("freshness")).toBe(
      "OK freshness 2_collected_channels_fresh",
    );
    expect(run.status).toBe(0);
  });

  test("warns, never passes, when the counts cannot be read", async () => {
    freshness = '{"message":"permission denied"}';
    const run = await monitor();
    expect(run.line("freshness")).toBe("WARN freshness unreadable_counts");
    expect(run.status).toBe(1);
  });
});

describe("the monitor's own configuration", () => {
  test("fails loudly, naming what is missing and contacting nothing", async () => {
    const run = await monitor({ WORKER_CREDENTIAL: "" });
    expect(run.line("monitor")).toBe(
      "FAIL monitor not_configured:WORKER_CREDENTIAL",
    );
    expect(run.status).toBe(2);
    expect(calls).toEqual([]);
  });

  test("reports itself configured, so a not_configured alert can close", async () => {
    expect((await monitor()).line("monitor")).toBe("OK monitor configured");
  });

  test("never prints a credential", async () => {
    const run = await monitor({ PREVIEW_URL: `${base}/workspaces-not-here` });
    expect(run.stdout + run.stderr).not.toContain(SERVICE_KEY);
    expect(run.stdout + run.stderr).not.toContain("test-worker-credential");
  });
});

describe("the monitor's site check", () => {
  test("probes the public site without basic auth", async () => {
    const run = await monitor({ PREVIEW_URL: `${base}/rest/v1/workspaces` });
    expect(run.line("site")).toBe("OK site 200");
  });
});
