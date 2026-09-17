// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import type { Snapshot } from "./Dashboard";
import { Compare } from "./Compare";

/**
 * Fix round 1: the "التوزيع" cell's bar and its printed shares must agree.
 * One video, half analysed — two of its four comments carry no label at
 * all — so a bar drawn against `total` (4) would show 25% segments while
 * the list beside it prints shares of `analysed` (2), i.e. 50%. This test
 * pins the bar to the same 50% the text prints.
 */
const video = {
  id: "v1",
  title: "فيديو اختبار",
  total: 4,
  analysed: 2,
  replies: 0,
  sentiments: { positive: 1, negative: 1, neutral: 0, mixed: 0 },
};

const s = {
  comparison: [video],
  comparison_truncated: false,
} as unknown as Snapshot;

describe("Compare", () => {
  it("draws the distribution bar and prints its shares over the same denominator", () => {
    render(<Compare s={s} S={ar} labels={ar.labels} onPick={() => {}} />);
    const bar = screen.getByRole("img");
    const segments = bar.querySelectorAll("i");
    // One positive, one negative, of two analysed — half the bar each, not
    // a quarter of the video's four total comments.
    expect(segments).toHaveLength(2);
    for (const seg of segments) expect(seg).toHaveStyle({ width: "50%" });

    const row = screen.getByTestId("compare-v1");
    // The printed shares (the `<ul className="share">` list) read the same
    // 50% the bar just drew.
    expect(row).toHaveTextContent("50٪");
    expect(row).not.toHaveTextContent("25٪");

    // The bar's own spoken form matches what is printed, not a silent
    // decoration of it.
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("50"));
  });
});
