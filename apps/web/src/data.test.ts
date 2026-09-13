import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulate a fully configured Supabase project. Product Auth being available
// must not imply that the dashboard's comment data is live.
const rpc = vi.fn(async () => ({ error: null }));
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
    await submitReview({
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    expect(rpc).not.toHaveBeenCalled();
    // The UI must keep telling the truth about persistence.
    expect(reviewsArePersisted).toBe(false);
  });

  it("keeps the correction in the session view rather than claiming a server wrote it", async () => {
    const { submitReview, loadSnapshot, fixtureWorkspace } = await loadModule();
    await submitReview({
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    const view = await loadSnapshot(
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
      submitReview({
        workspace_id: fixtureWorkspace,
        comment_id: target.id,
        content_hash: "hash-of-older-text",
        label: "negative",
        reason: "تصنيف خاطئ",
      }),
    ).rejects.toThrow("stale_comment_text");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the data mode it is actually serving", async () => {
    const { dataMode } = await loadModule();
    expect(dataMode).toBe("sanitized_fixture");
  });
});
