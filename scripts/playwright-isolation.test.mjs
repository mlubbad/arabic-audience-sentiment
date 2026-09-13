import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function runPlaywright(port) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        resolve(root, "playwright.config.ts"),
        "--grep",
        "Arabic fixture shell",
      ],
      {
        cwd: root,
        env: { ...process.env, E2E_PORT: String(port), CI: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code, output }));
  });
}
test(
  "Playwright fails closed when a foreign server occupies its test port",
  { timeout: 60000 },
  async () => {
    const foreign = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<title>FOREIGN WORKTREE</title>");
    });
    await new Promise((ready, reject) => {
      foreign.once("error", reject);
      foreign.listen(0, "127.0.0.1", ready);
    });
    try {
      const { port } = foreign.address();
      const result = await runPlaywright(port);
      assert.notEqual(
        result.code,
        0,
        `Browser suite falsely passed: ${result.output}`,
      );
      assert.match(
        result.output,
        /already used|already in use|EADDRINUSE/,
        result.output,
      );
      assert.doesNotMatch(result.output, /\b1 passed\b/);
    } finally {
      await new Promise((done) => foreign.close(done));
    }
  },
);
