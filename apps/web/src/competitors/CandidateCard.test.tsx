// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CandidateCard } from "./CandidateCard";
import { suggestionsSchema } from "../api/competitors";

const entry = suggestionsSchema.parse({
  channel: {
    id: "UC1",
    title: "قناتي",
    handle: null,
    subscriber_count: null,
    subscriber_count_hidden: null,
    country: null,
    default_language: null,
    topic_categories: null,
    channel_published_at: null,
    profile_observed_at: null,
    stats_observed_at: null,
  },
  limit: null,
  tracked_count: 0,
  candidates: [
    {
      external_id: "UC2",
      title: null,
      handle: "@other",
      sources: ["featured"],
      status: null,
      subscriber_count: null,
      view_count: null,
      video_count: null,
      profile_observed_at: null,
      score: null,
      tier: null,
      reasons: [{ kind: "future_reason" }],
    },
  ],
}).candidates[0];
describe("CandidateCard", () =>
  it("keeps unknown counts and scores unknown, and ignores unknown reasons", () => {
    render(
      <CandidateCard
        item={entry}
        canEdit={false}
        pending={false}
        act={() => {}}
      />,
    );
    expect(screen.getByText("@other")).toBeTruthy();
    expect(screen.getByText(/لا تكفي البيانات بعد/)).toBeTruthy();
    expect(screen.queryByText("future_reason")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".competitor-card")?.textContent).toContain(
      "—",
    );
  }));
