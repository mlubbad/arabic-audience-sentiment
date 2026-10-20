// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeVideos } from "./BridgeVideos";
import type { Strings } from "../strings";

afterEach(cleanup);
const S = {
  audienceVideos: "Bridge videos",
  audienceVideosLoading: "Loading videos",
  audienceInsufficient: "Not enough data",
  audienceNoVideos: "No video reaches privacy floor",
  audienceOurCalculation: "our calculation",
} as Strings;
describe("BridgeVideos", () => {
  it("keeps below-threshold and empty results honest", () => {
    const { rerender } = render(
      <BridgeVideos
        data={{ status: "below_threshold", videos: [] }}
        platform="youtube"
        lang="en"
        S={S}
      />,
    );
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
    rerender(
      <BridgeVideos
        data={{ status: "ready", videos: [] }}
        platform="youtube"
        lang="en"
        S={S}
      />,
    );
    expect(
      screen.getByText("No video reaches privacy floor"),
    ).toBeInTheDocument();
  });
  it("links YouTube videos only", () => {
    const video = {
      video_id: "v1",
      external_video_id: "abc",
      title: "Bridge",
      published_at: null,
      shared_commenters: 6,
      video_audience: 10,
      affinity: 300,
    };
    const { rerender } = render(
      <BridgeVideos
        data={{ status: "ready", videos: [video] }}
        platform="youtube"
        lang="en"
        S={S}
      />,
    );
    expect(screen.getByRole("link", { name: "Bridge" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abc",
    );
    rerender(
      <BridgeVideos
        data={{ status: "ready", videos: [video] }}
        platform="telegram"
        lang="en"
        S={S}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Bridge")).toBeInTheDocument();
  });
});
