import { describe, expect, it, vi } from "vitest";
import { entryScript, verifyDeploy } from "./verify-deploy.mjs";

const page = (entry: string) =>
  `<!doctype html><html><head><script defer src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>` +
  `<script type="module" crossorigin src="${entry}"></script>` +
  `<link rel="modulepreload" crossorigin href="/static/vendor-react-D2Sv4MLw.js"></head></html>`;

const respond = (status: number, body = "") =>
  new Response(status === 200 ? body : null, { status });

describe("entryScript", () => {
  it("reads the module entry, not the third-party script or a preload", () => {
    expect(entryScript(page("/static/index-DjOUiVVm.js"))).toBe(
      "/static/index-DjOUiVVm.js",
    );
  });

  it("returns null when the document names no hashed entry", () => {
    expect(
      entryScript("<html><body>DirectAdmin placeholder</body></html>"),
    ).toBe(null);
  });
});

describe("verifyDeploy", () => {
  const base = {
    expected: "/static/index-DjOUiVVm.js",
    baseUrl: "https://app.example.test",
    sha: "851f869",
    attempts: 3,
    delayMs: 0,
  };

  it("passes when the live page loads this build's entry and the entry answers 200", async () => {
    const fetchImpl = vi.fn(async (url: URL) =>
      url.pathname === "/account"
        ? respond(200, page("/static/index-DjOUiVVm.js"))
        : respond(200),
    );
    await expect(verifyDeploy({ ...base, fetchImpl })).resolves.toBe(
      "/static/index-DjOUiVVm.js",
    );
    const first = fetchImpl.mock.calls[0][0] as URL;
    expect(first.searchParams.get("deploy-check")).toBe("851f869");
  });

  it("fails on the 2026-10-02 incident: upload succeeded, site serves another build", async () => {
    const fetchImpl = vi.fn(async () =>
      respond(200, page("/static/index-Bl0nMJSR.js")),
    );
    await expect(verifyDeploy({ ...base, fetchImpl })).rejects.toThrow(
      /live site loads \/static\/index-Bl0nMJSR\.js, this build is \/static\/index-DjOUiVVm\.js/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries until the new build appears", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname !== "/account") return respond(200);
      calls++;
      return respond(
        200,
        page(
          calls < 2 ? "/static/index-Bl0nMJSR.js" : "/static/index-DjOUiVVm.js",
        ),
      );
    });
    await expect(verifyDeploy({ ...base, fetchImpl })).resolves.toBe(
      "/static/index-DjOUiVVm.js",
    );
  });

  it("fails when the entry the page names is missing at the origin", async () => {
    const fetchImpl = vi.fn(async (url: URL) =>
      url.pathname === "/account"
        ? respond(200, page("/static/index-DjOUiVVm.js"))
        : respond(404),
    );
    await expect(verifyDeploy({ ...base, fetchImpl })).rejects.toThrow(
      /index-DjOUiVVm\.js answered 404/,
    );
  });

  it("fails on a non-200 page and on network errors", async () => {
    await expect(
      verifyDeploy({ ...base, fetchImpl: vi.fn(async () => respond(403)) }),
    ).rejects.toThrow(/\/account answered 403/);
    await expect(
      verifyDeploy({
        ...base,
        fetchImpl: vi.fn(async () => {
          throw new Error("ECONNRESET");
        }),
      }),
    ).rejects.toThrow(/request failed: ECONNRESET/);
  });

  it("refuses a build whose app.html names no entry", async () => {
    await expect(
      verifyDeploy({ ...base, expected: null, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/names no \/static\/index-\*\.js entry/);
  });
});
