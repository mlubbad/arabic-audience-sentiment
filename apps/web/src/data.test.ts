import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulate a fully configured Supabase project. Product Auth being available
// must not imply that the dashboard's comment data is live.
type RpcResult = { data?: unknown; error: { message?: string } | null };
const rpc = vi.fn<
  (name: string, args?: Record<string, unknown>) => Promise<RpcResult>
>(async () => ({ data: null, error: null }));
vi.mock("./supabase", () => ({ supabase: { rpc } }));

const fixtureJson = readFileSync(
  "apps/web/public/fixtures/dashboard.json",
  "utf8",
);
const fixture = JSON.parse(fixtureJson) as {
  comments: { id: string; content_hash: string; text_raw: string }[];
};
const target = fixture.comments[0];

async function loadModule() {
  vi.resetModules();
  return import("./data");
}

beforeEach(() => {
  rpc.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(fixtureJson, { status: 200 })),
  );
});

describe("fixture and live modes stay separate", () => {
  it("does not send a fixture correction to a live RPC when Auth is configured", async () => {
    const { submitReview, fixtureWorkspace, reviewsArePersisted } =
      await loadModule();
    // Fixture rows carry fixture ids and a fixture workspace. No live server
    // would accept them, so the correction must never be addressed to one.
    await submitReview("sanitized_fixture", {
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    expect(rpc).not.toHaveBeenCalled();
    // The UI must keep telling the truth about persistence.
    expect(reviewsArePersisted("sanitized_fixture")).toBe(false);
  });

  it("keeps the correction in the session view rather than claiming a server wrote it", async () => {
    const { submitReview, loadSnapshot, fixtureWorkspace } = await loadModule();
    await submitReview("sanitized_fixture", {
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    const view = await loadSnapshot(
      "sanitized_fixture",
      { workspace_id: fixtureWorkspace },
      new AbortController().signal,
    );
    const row = view.comments.find((c) => c.id === target.id)!;
    expect(row.label).toBe("negative");
    expect(row.reviewed).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still refuses a verdict on text that changed, without falling back to the server", async () => {
    const { submitReview, fixtureWorkspace } = await loadModule();
    await expect(
      submitReview("sanitized_fixture", {
        workspace_id: fixtureWorkspace,
        comment_id: target.id,
        content_hash: "hash-of-older-text",
        label: "negative",
        reason: "تصنيف خاطئ",
      }),
    ).rejects.toThrow("stale_comment_text");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the furthest mode this build is allowed to serve", async () => {
    const { configuredMode } = await loadModule();
    expect(configuredMode).toBe("sanitized_fixture");
  });

  it("cannot be talked into a live read by a session on a demo build", async () => {
    // Configuration is the ceiling. A signed-in user with a real workspace id
    // still gets the fixture here, because this build has no live source to
    // read and addressing one would be a request to a server that was never
    // configured.
    const { resolveMode } = await loadModule();
    expect(
      resolveMode({
        signedIn: true,
        workspace: "9f1f0f38-0000-4000-8000-000000000001",
      }),
    ).toBe("sanitized_fixture");
  });
});

describe("the live path reads and writes against the same source", () => {
  const live = () => ({
    ...JSON.parse(fixtureJson),
    mode: "live",
    revision: "2026-09-13T10:00:00Z",
  });

  beforeEach(() => {
    vi.stubEnv("VITE_DASHBOARD_SOURCE", "live");
  });

  it("reads the snapshot from the server and not from the fixture file", async () => {
    rpc.mockResolvedValueOnce({ data: live(), error: null });
    const { loadSnapshot, configuredMode } = await loadModule();
    expect(configuredMode).toBe("live");
    const view = await loadSnapshot(
      "live",
      { workspace_id: "00000000-0000-4000-8000-000000000001" },
      new AbortController().signal,
    );
    expect(rpc).toHaveBeenCalledWith("dashboard_snapshot", {
      w: "00000000-0000-4000-8000-000000000001",
    });
    // The file is never read in live mode: serving a fixture row beside live
    // ones is how the two would be mistaken for each other.
    expect(fetch).not.toHaveBeenCalled();
    expect(view.total).toBeGreaterThan(0);
    expect(view.mode).toBe("live");
  });

  it("sends a correction to the server, carrying a verdict and no identity", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { submitReview } = await loadModule();
    await submitReview("live", {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      comment_id: "aaaaaaaa-0000-4000-8000-000000000001",
      content_hash: "h1",
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("submit_comment_review");
    expect(args).toBeDefined();
    // The reviewer and the human provenance come from the session inside the
    // RPC. Sending them would let the caller attribute a correction.
    expect(Object.keys(args!).sort()).toEqual([
      "c",
      "seen_hash",
      "verdict",
      "w",
      "why",
    ]);
  });

  it("refuses a server answer of the wrong shape instead of half-rendering it", async () => {
    // A snapshot missing its comments is not an empty dashboard; it is a read
    // that did not happen, and it must not be drawn as zero comments.
    rpc.mockResolvedValueOnce({
      data: { ...live(), comments: undefined },
      error: null,
    });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("refuses rows that break the contract even when the shape looks right", async () => {
    // The structural case above would fail without any parsing, because
    // snapshot() cannot walk an undefined list. This one would not: a failed
    // prediction carrying a label is a well-formed object that renders happily
    // as a labelled comment, and only the schema refuses it.
    const payload = live();
    payload.comments[0].prediction = {
      ...payload.comments[0].prediction,
      status: "failed",
      label: "positive",
    };
    rpc.mockResolvedValueOnce({ data: payload, error: null });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("does not leak the server's error text to the caller", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "https://project.supabase.co/rest/v1/rpc?apikey=secret",
      },
    });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("live_unavailable");
  });

  it("goes live only with a session and a workspace, never with one of them", async () => {
    const { resolveMode } = await loadModule();
    const workspace = "9f1f0f38-0000-4000-8000-000000000001";
    expect(resolveMode({ signedIn: true, workspace })).toBe("live");
    // A workspace id with no session is a claim, not an entitlement: the id
    // could have come from a URL, a stale render or another tenant.
    expect(resolveMode({ signedIn: false, workspace })).toBe(
      "sanitized_fixture",
    );
    // And a session with nothing resolved has no live rows to show. Falling
    // back to the fixture workspace under a live mode would read the demo id
    // from the real server.
    expect(resolveMode({ signedIn: true, workspace: null })).toBe(
      "sanitized_fixture",
    );
  });

  it("says corrections are persisted, because now they are", async () => {
    const { reviewsArePersisted } = await loadModule();
    expect(reviewsArePersisted("live")).toBe(true);
  });
});
