import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The worker image shipped without a model for weeks: SENTIMENT_MODEL=none and
// no `inference` group, so a deployed container collected and never classified
// (found 2026-10-12, while preparing Oracle hosting). These guards keep the
// image able to classify and keep it built the way CI builds Python.
const dockerfile = readFileSync("workers/python/Dockerfile", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");
const workflow = readFileSync(".github/workflows/worker-image.yml", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("the worker image", () => {
  test("installs the inference group and defaults to the pinned classifier", () => {
    expect(dockerfile).toContain("uv sync --frozen --no-dev --group inference");
    expect(dockerfile).toMatch(/^\s+SENTIMENT_MODEL=camelbert-da \\$/m);
    // The ENV line, not prose: the file's comment names the old value.
    expect(dockerfile).not.toMatch(/^\s+SENTIMENT_MODEL=none\b/m);
  });

  test("builds on the Python and uv versions CI uses, pinned by digest", () => {
    const python = ci.match(/python-version: (\S+)/)?.[1];
    const uv = ci.match(/^\s+version: (\d+\.\d+\.\d+)$/m)?.[1];
    expect(python).toBeTruthy();
    expect(uv).toBeTruthy();
    expect(dockerfile).toMatch(
      new RegExp(`^FROM python:${python}-slim@sha256:[0-9a-f]{64}$`, "m"),
    );
    expect(dockerfile).toMatch(
      new RegExp(
        `^COPY --from=ghcr\\.io/astral-sh/uv:${uv}@sha256:[0-9a-f]{64} `,
        "m",
      ),
    );
    expect(dockerfile).toContain("UV_PYTHON_DOWNLOADS=never");
  });

  test("runs as a non-root user, with the model cache on a volume", () => {
    expect(dockerfile).toMatch(/^USER worker$/m);
    expect(dockerfile).toContain("HF_HOME=/app/.cache/huggingface");
    expect(compose).toContain("hf-cache:/app/.cache/huggingface");
    expect(compose).toMatch(/^ {10}memory: 4G$/m);
  });
});

describe("the worker image workflow", () => {
  test("builds on arm64, as the server runs, and classifies inside the image", () => {
    expect(workflow).toMatch(/^ {4}runs-on: ubuntu-24\.04-arm$/m);
    expect(workflow).toContain(
      "docker build --tag sentiment-worker:ci workers/python",
    );
    expect(workflow).toContain('load_pinned("camelbert-da")');
    expect(workflow).toContain("docker run --rm -i");
  });

  test("follows the repository's workflow rules", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).toMatch(/^concurrency:$/m);
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toMatch(
      /^ {4}if: github\.event\.pull_request\.draft != true$/m,
    );
    for (const m of workflow.matchAll(/^\s+- uses: (\S+)/gm))
      expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    // Nothing secret reaches a public log.
    expect(workflow).not.toContain("secrets.");
  });
});
