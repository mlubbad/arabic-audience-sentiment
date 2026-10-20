// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlapTable, shareText } from "./OverlapTable";
import type { Overlap } from "../api/audience";
import type { Strings } from "../strings";

afterEach(cleanup);
const S = {
  audienceChannel: "Channel",
  audienceTheirSize: "Their audience",
  audienceShareMine: "Share of yours",
  audienceShareTheirs: "Share of theirs",
  audienceAffinity: "Affinity",
  audienceHigh: "High overlap",
  audienceInsufficient: "Not enough data",
  audienceOurCalculation: "our calculation",
} as Strings;
function sample(share: number, below = false): Overlap {
  return {
    status: "ready",
    computed_at: "2026-10-20T12:00:00Z",
    universe_size: 1000,
    thresholds: { min_audience: 100, min_shared: 10 },
    channel: { id: "a", title: "A", platform: "youtube", audience_size: 500 },
    others: [
      {
        channel_id: "b",
        title: "B",
        handle: null,
        platform: "youtube",
        audience_size: 300,
        below_threshold: below,
        shared: below ? null : 62,
        share_of_mine: below ? null : share,
        share_of_mine_ci: below ? null : { low: 0.09, high: 0.15 },
        share_of_theirs: below ? null : 0.2,
        overlap_coefficient: below ? null : 0.24,
        affinity: below ? null : 240,
      },
    ],
  };
}
describe("OverlapTable", () => {
  it("formats Wilson percentages with pinned English and Arabic digits", () => {
    expect(shareText(0.1234, { low: 0.09, high: 0.15 }, "en")).toBe(
      "12 % (9–15 %)",
    );
    expect(shareText(0.1234, { low: 0.09, high: 0.15 }, "ar")).toBe(
      "12 ٪ (9–15 ٪)",
    );
  });
  it("shows the high badge strictly above 30% and affinity beyond its midpoint", () => {
    const { rerender } = render(
      <OverlapTable
        data={sample(0.3)}
        selected={null}
        onSelect={vi.fn()}
        lang="en"
        S={S}
      />,
    );
    expect(screen.queryByText("High overlap")).not.toBeInTheDocument();
    rerender(
      <OverlapTable
        data={sample(0.31)}
        selected={null}
        onSelect={vi.fn()}
        lang="en"
        S={S}
      />,
    );
    expect(screen.getByText("High overlap")).toBeInTheDocument();
    expect(document.querySelector(".audience-affinity-10")).toBeInTheDocument();
    expect(
      screen.getAllByText("our calculation: 31 % (9–15 %)").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/our calculation/).length).toBeGreaterThan(2);
  });
  it("hides all numeric values below threshold and permits selecting a row", () => {
    const select = vi.fn();
    render(
      <OverlapTable
        data={sample(0.12, true)}
        selected={null}
        onSelect={select}
        lang="en"
        S={S}
      />,
    );
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0%|0٪/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).not.toHaveTextContent(/\b0\b/);
    screen.getByRole("button", { name: "B" }).click();
    expect(select).toHaveBeenCalledWith("b");
    // The phone card says the same as the table, never "—".
    expect(document.querySelector(".audience-card")).toHaveTextContent(
      "Not enough data",
    );
  });
  it("labels the main share as our calculation, in the table and the card", () => {
    render(
      <OverlapTable
        data={sample(0.12)}
        selected={null}
        onSelect={vi.fn()}
        lang="en"
        S={S}
      />,
    );
    const row = screen.getAllByRole("row")[1]!;
    expect(row.querySelectorAll("td")[2]).toHaveTextContent(
      "our calculation: 12 % (9–15 %)",
    );
    expect(document.querySelector(".audience-card")).toHaveTextContent(
      "our calculation: 12 % (9–15 %)",
    );
  });
});
