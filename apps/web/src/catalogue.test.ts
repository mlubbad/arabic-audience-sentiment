import { describe, expect, it } from "vitest";
import { mergeCatalogue, type RawCatalogue } from "./catalogue";

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
