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
const { tableResults, from, ranges } = vi.hoisted(() => {
  const tableResults: Record<string, TableResult> = {
    videos: { data: [], error: null },
    video_selections: { data: [], error: null },
    connection_status: { data: [], error: null },
  };
  // `videos` and `video_selections` are read in pages of 1,000 by a stable
  // key (`.order(key).range(a, b)`); `connection_status` in one `.eq`. The
  // stand-in slices the table's rows for a range and counts the requests.
  const ranges: Record<string, number[][]> = {};
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => {
        const result = tableResults[table];
        const paged = {
          order: () => ({
            range: async (a: number, b: number) => {
              (ranges[table] ??= []).push([a, b]);
              if (result.error) return result;
              return { data: (result.data ?? []).slice(a, b + 1), error: null };
            },
          }),
        };
        // `.eq(...)` is both awaited directly (connection_status) and chained
        // (the paged reads); a thenable with `order` serves both.
        return Object.assign(Promise.resolve(result), paged);
      },
    }),
  }));
  return { tableResults, from, ranges };
});
vi.mock("./supabase", () => ({ supabase: { from } }));

import {
  loadCatalogue,
  mergeCatalogue,
  storedPerVideo,
  type RawCatalogue,
} from "./catalogue";

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

describe("storedPerVideo", () => {
  const row = (id: string, video_id: string, by_channel_owner: boolean) =>
    ({
      id,
      video_id,
      by_channel_owner,
      workspace_id: "w1",
    }) as unknown as import("@sentiment/contracts").Comment;

  it("counts every stored row, the channel's own replies included", () => {
    // The server prices a selection with `count(*)` over the video's rows;
    // the dashboard's aggregate leaves the owner's replies out. The
    // catalogue must agree with the server, or its estimate says "fits" for
    // a selection the database then refuses.
    const counts = storedPerVideo(
      [
        row("c1", "video-1", false),
        row("c2", "video-1", true),
        row("c2", "video-1", true), // a duplicate row is one comment
        row("c3", "video-2", false),
        { ...row("c4", "video-1", false), workspace_id: "other" },
      ],
      "w1",
    );
    expect(counts).toEqual([
      { id: "video-1", total: 2 },
      { id: "video-2", total: 1 },
    ]);
  });
});

describe("mergeCatalogue", () => {
  it("joins the source's list with the selection and the stored count", () => {
    const rows = mergeCatalogue(raw, [{ id: "video-1", total: 5 }]);
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
    for (const k of Object.keys(ranges)) delete ranges[k];
  });

  // The pilot channel's first discovery catalogued 4,456 videos; PostgREST
  // answered a single unpaged read with exactly 1,000 and no error, and the
  // page would have shown 1,000 as if that were the channel.
  it("pages the videos past PostgREST's thousand-row cap", async () => {
    const video = (i: number) => ({
      id: `v${i}`,
      external_video_id: String(i).padStart(11, "0"),
      title: `فيديو ${i}`,
      kind: "video",
      published_at: null,
      thumbnail_url: null,
      reported_comment_count: 1,
      comments_state: "open",
    });
    tableResults.videos = {
      data: Array.from({ length: 1456 }, (_, i) => video(i)),
      error: null,
    };
    const read = await loadCatalogue("live", "workspace-1");
    expect(read.videos).toHaveLength(1456);
    expect(ranges.videos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // An exact multiple asks once more and gets an empty page: no row is lost.
    tableResults.videos = {
      data: Array.from({ length: 1000 }, (_, i) => video(i)),
      error: null,
    };
    delete ranges.videos;
    expect((await loadCatalogue("live", "workspace-1")).videos).toHaveLength(
      1000,
    );
    expect(ranges.videos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
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
