// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Label } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import type { PageSlice } from "../videoPaging";
import type { Snapshot } from "./Dashboard";
import { Videos } from "./Videos";

/** Only the fields `Videos` actually reads off a video (see
 *  `VideoAggregate` in `packages/contracts/src/snapshot.ts`). */
const video = {
  id: "v1",
  title: "فيديو اختبار",
  total: 4,
  analysed: 2,
  replies: 0,
  sentiments: { positive: 1, negative: 1, neutral: 0, mixed: 0 },
};

const s = {
  measurable: new Set<Label>(["positive", "negative", "neutral", "mixed"]),
  videos: [video],
} as unknown as Snapshot;

const slice: PageSlice<typeof video> = {
  items: [video],
  page: 0,
  pages: 1,
  from: 1,
  to: 1,
};

describe("Videos", () => {
  it("draws a half-analysed video as two 25% segments, not a full bar", () => {
    render(
      <Videos
        s={s}
        S={ar}
        slice={slice}
        video=""
        onTurn={() => {}}
        onPick={() => {}}
      />,
    );
    const bar = screen.getByRole("img");
    const segments = bar.querySelectorAll("i");
    // Two analysed of four total: one positive, one negative, each a
    // quarter of the bar — not two segments stretched to fill it.
    expect(segments).toHaveLength(2);
    for (const seg of segments) expect(seg).toHaveStyle({ width: "25%" });
    expect(bar).toHaveAttribute(
      "aria-label",
      expect.stringContaining(ar.labels.positive),
    );
    expect(bar).toHaveAttribute(
      "aria-label",
      expect.stringContaining(ar.labels.negative),
    );
    // Spoken shares are over `analysed`, like every printed percentage on
    // the page: one of two analysed is 50%, not the 25% of total the bar
    // draws.
    expect(bar).toHaveAttribute(
      "aria-label",
      ar.legendMeasured(ar.labels.positive, "1", 50) +
        "، " +
        ar.legendMeasured(ar.labels.negative, "1", 50),
    );
  });

  it("renders em-dash for engagement rate when like_count is null", () => {
    const videoNullLikes = {
      ...video,
      id: "v2",
      view_count: 100,
      like_count: null,
      total: 10,
    };
    const sNull = {
      ...s,
      videos: [videoNullLikes],
    } as unknown as Snapshot;
    const sliceNull = {
      ...slice,
      items: [videoNullLikes],
    };

    render(
      <Videos
        s={sNull}
        S={ar}
        slice={sliceNull}
        video=""
        onTurn={() => {}}
        onPick={() => {}}
      />,
    );

    expect(screen.getByText(`— ${ar.kpiEngagement}`)).toBeInTheDocument();
  });

  it("formats engagement rate with % in English locale when like_count is present", () => {
    const videoWithLikes = {
      ...video,
      id: "v3",
      view_count: 100,
      like_count: 10,
      total: 10, // (10 + 10) / 100 = 20%
    };
    const sEn = {
      ...s,
      videos: [videoWithLikes],
    } as unknown as Snapshot;
    const sliceEn = {
      ...slice,
      items: [videoWithLikes],
    };

    render(
      <Videos
        s={sEn}
        S={ar}
        slice={sliceEn}
        video=""
        onTurn={() => {}}
        onPick={() => {}}
        lang="en"
      />,
    );

    expect(screen.getByText(`20% ${ar.kpiEngagement}`)).toBeInTheDocument();
  });
});
