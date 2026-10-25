// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetitorIntelligence as CompetitorIntelligenceData } from "../api/competitors";
import { ar } from "../strings/ar";
import { CompetitorIntelligence } from "./CompetitorIntelligence";

vi.mock("./useCompetitors", () => ({
  useUpsertCompetitorIntelligence: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("CompetitorIntelligence 11-point matrix and SWOT battlecards", () => {
  it("renders the gradual pacing schedule, 11-point comparison matrix, and SWOT battlecards", () => {
    const sample: CompetitorIntelligenceData = {
      days: 30,
      tracked_count: 1,
      own: {
        id: "ch-1",
        external_id: "UC_OWN",
        title: "قناتي التقنية",
        handle: "@mytech",
        platform: "youtube",
        connected_platforms: ["youtube", "facebook"],
        connection_strategy: "tailored_multi",
        subscribers: 25000,
        subscribers_change: 500,
        views: 800000,
        videos: 80,
        videos_per_week: 2.0,
        views_per_video: 10000,
        dominant_format: "mixed",
        funnel_stage: "consideration",
        topics_covered: ["https://en.wikipedia.org/wiki/Technology"],
        tone_of_voice: "bilingual_friendly",
      },
      competitors: [
        {
          external_id: "UC_COMP_1",
          title: "منافس البرمجيات",
          handle: "@comp1",
          status: "tracked",
          tier: "direct",
          connection_between_platforms: "single_focus",
          primary_platform: "youtube",
          subscribers: 60000,
          subscribers_change: -50,
          size_ratio: 2.4,
          videos: 40,
          videos_per_week: 0.5,
          capacity_state: "dormant_brand_opportunity",
          views: 200000,
          views_per_video: 5000,
          views_per_video_ratio_vs_own: 0.5,
          dominant_format: "video",
          funnel_stage: "awareness",
          next_funnel_stage: "consideration",
          topics_covered: ["https://en.wikipedia.org/wiki/Technology"],
          topic_gaps: ["https://en.wikipedia.org/wiki/Artificial_intelligence"],
          tone_of_voice: "semi_formal",
          cta_pattern: "اشترك في القناة",
          conversion_channel: "https://comp1.example.com",
          strengths: ["strong_subscriber_base"],
          weaknesses: [
            "low_publishing_frequency",
            "lower_views_per_video_than_own",
          ],
          opportunity_gap: "dormant_giant_capture",
          threat_level: "medium",
        },
      ],
      pacing_plan: {
        current_weekly_posts: 2.0,
        benchmark_weekly_posts: 3.0,
        recommended_weekly_posts: 3.0,
        week_1_schedule: [2, 3, 2, 3],
        week_2_schedule: [3, 3, 3, 3],
      },
    };

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <CompetitorIntelligence
          channel="ch-1"
          canEdit={true}
          intelligenceQuery={
            {
              isPending: false,
              data: sample,
            } as never
          }
          S={ar}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("competitor-intelligence")).toBeInTheDocument();
    expect(screen.getByTestId("intel-pacing-plan")).toBeInTheDocument();
    expect(screen.getByTestId("battlecard-UC_COMP_1")).toBeInTheDocument();
    expect(screen.getAllByText("منافس البرمجيات").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(ar.compIntelGap_dormant_giant_capture).length,
    ).toBeGreaterThan(0);
  });
});
