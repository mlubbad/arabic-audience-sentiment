import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stand-in for the three `.from(table).select(...).eq(...)` reads
// `readLive` makes, keyed by table name so each of the three can be told to
// fail independently. Mirrors the `vi.mock("./supabase", ...)` pattern used
// by connect.test.ts and data.test.ts for the same reason: the real client
// needs a configured project, and the module under test resolves `supabase`
// at call time, not at import time.
type TableResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};
const { tableResults, from } = vi.hoisted(() => {
  const tableResults: Record<string, TableResult> = {
    videos: { data: [], error: null },
    video_selections: { data: [], error: null },
    connection_status: { data: [], error: null },
  };
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: async () => tableResults[table],
    }),
  }));
  return { tableResults, from };
});
vi.mock("./supabase", () => ({ supabase: { from } }));

import { loadCatalogue, mergeCatalogue, type RawCatalogue } from "./catalogue";

const raw: RawCatalogue = {
  videos: [
    {
      id: "video-1",
      external_video_id: "a".repeat(11),
      title: "فيديو ١",
      kind: "video",
      published_at: "2026-01-01T00:00:00Z",
      thumbnail_url: null,
      reported_comment_count: 40,
      comments_state: "open",
    },
    {
      id: "video-9",
      external_video_id: "b".repeat(11),
      title: "جديد",
      kind: "short",
      published_at: null,
      thumbnail_url: null,
      reported_comment_count: null,
      comments_state: "unknown",
    },
  ],
  selections: [
    {
      video_id: "video-1",
      last_collected_at: "2026-09-01T00:00:00Z",
      last_outcome: "exhausted",
      next_check_at: "2026-09-02T00:00:00Z",
    },
  ],
};

describe("mergeCatalogue", () => {
  it("joins the source's list with the selection and the stored count", () => {
    const rows = mergeCatalogue(raw, [
      {
        id: "video-1",
        title: "فيديو ١",
        total: 5,
        analysed: 5,
        replies: 1,
        sentiments: { positive: 1, negative: 1, neutral: 3, mixed: 0 },
      },
    ]);
    expect(rows.find((r) => r.id === "video-1")).toMatchObject({
      selected: true,
      collected: 5,
      last_outcome: "exhausted",
    });
    expect(rows.find((r) => r.id === "video-9")).toMatchObject({
      selected: false,
      collected: 0,
      reported_comment_count: null,
    });
  });
  it("refuses a row that does not fit the contract", () => {
    expect(() =>
      mergeCatalogue(
        { ...raw, videos: [{ ...raw.videos[0], kind: "clip" as never }] },
        [],
      ),
    ).toThrow();
  });
});

describe("loadCatalogue's live read", () => {
  beforeEach(() => {
    tableResults.videos = { data: [], error: null };
    tableResults.video_selections = { data: [], error: null };
    tableResults.connection_status = { data: [], error: null };
  });

  it("resolves when all three reads succeed", async () => {
    await expect(loadCatalogue("live", "workspace-1")).resolves.toMatchObject({
      channelId: null,
      cataloguedAt: null,
    });
  });

  // The bug this guards against: a failed `connection_status` read was
  // swallowed and produced `{ channelId: null, cataloguedAt: null }` — the
  // same shape as "no connected channel" — so a transient failure read as
  // "connect a channel first" instead of as an error. `channelStatus.ts`
  // throws on the same read failing; `readLive` must match it.
  it("refuses the read when connection_status fails, rather than reporting no connected channel", async () => {
    tableResults.connection_status = {
      data: null,
      error: { message: "boom" },
    };
    await expect(loadCatalogue("live", "workspace-1")).rejects.toThrow(
      "catalogue_unavailable",
    );
  });

  it("still refuses when videos or video_selections fails", async () => {
    tableResults.videos = { data: null, error: { message: "boom" } };
    await expect(loadCatalogue("live", "workspace-1")).rejects.toThrow(
      "catalogue_unavailable",
    );
  });
});
