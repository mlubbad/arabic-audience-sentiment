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
        lang="en"
        S={S}
      />,
    );
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
    rerender(
      <BridgeVideos data={{ status: "ready", videos: [] }} lang="en" S={S} />,
    );
    expect(
      screen.getByText("No video reaches privacy floor"),
    ).toBeInTheDocument();
  });
});
