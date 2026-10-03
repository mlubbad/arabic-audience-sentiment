// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import type { Snapshot } from "./Dashboard";
import { Summary } from "./Summary";

const baseSnapshot = {
  total: 100,
  analysed: 80,
  unanalysed: 20,
  replies: 15,
  unique_authors: 60,
  unknown_dates: 0,
  channel_own_comments: 2,
  sentiments: { positive: 60, negative: 10, neutral: 10, mixed: 0 },
  topic_counts: { content: 40, sound: 10 },
  videos: [
    {
      id: "v1",
      title: "فيديو الذكاء الاصطناعي",
      total: 50,
      analysed: 40,
      replies: 5,
      sentiments: { positive: 30, negative: 5, neutral: 5, mixed: 0 },
    },
  ],
  most_engaged_negative: [],
} as unknown as Snapshot;

describe("Summary Executive Story Briefing", () => {
  it("renders the Executive Story Briefing with Net Sentiment pulse gauge and 3 acts in Arabic", () => {
    render(
      <Summary
        s={baseSnapshot}
        S={ar}
        topicName={(k) => (k === "content" ? "المحتوى والجودة" : k)}
      />,
    );

    // Section title
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      ar.secSummaryTitle,
    );

    // Briefing card presence
    const briefing = screen.getByTestId("story-briefing");
    expect(briefing).toBeInTheDocument();

    // Net Sentiment gauge calculation: (60 - 10) / 80 = 50 / 80 = 62.5% -> +63%
    expect(briefing).toHaveTextContent("+63٪");
    expect(briefing).toHaveTextContent(ar.pulseStrongPositive);
    expect(briefing).toHaveTextContent(ar.netSentimentScoreLabel);

    // Act 1, 2, 3 titles
    expect(screen.getByText(ar.storyAct1Title)).toBeInTheDocument();
    expect(screen.getByText(ar.storyAct2Title)).toBeInTheDocument();
    expect(screen.getByText(ar.storyAct3Title)).toBeInTheDocument();

    // Act 2 contains dominant topic name
    expect(briefing).toHaveTextContent("المحتوى والجودة");

    // Existing KPI and insight cards still present and correct
    expect(screen.getByTestId("total")).toHaveTextContent("100");
    expect(screen.getByTestId("replies-count")).toHaveTextContent("15");
    expect(screen.getByTestId("owner-excluded")).toHaveTextContent(
      ar.ownerExcluded("2"),
    );
  });

  it("renders properly in English with correct directional score", () => {
    render(<Summary s={baseSnapshot} S={en} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      en.secSummaryTitle,
    );
    const briefing = screen.getByTestId("story-briefing");
    expect(briefing).toHaveTextContent("+63%");
    expect(briefing).toHaveTextContent(en.pulseStrongPositive);
    expect(briefing).toHaveTextContent(en.storyAct1Title);
    expect(briefing).toHaveTextContent(en.storyAct3Title);
  });

  it("classifies negative sentiment alert when negatives exceed positives", () => {
    const criticalSnapshot = {
      ...baseSnapshot,
      sentiments: { positive: 10, negative: 50, neutral: 20, mixed: 0 },
      most_engaged_negative: [{ id: "c1", likes_value: 100 }],
    } as unknown as Snapshot;

    render(<Summary s={criticalSnapshot} S={ar} />);
    const briefing = screen.getByTestId("story-briefing");
    // (10 - 50) / 80 = -40 / 80 = -50% -> -50%
    expect(briefing).toHaveTextContent("-50٪");
    expect(briefing).toHaveTextContent(ar.pulseCriticalAlert);
    expect(briefing).toHaveTextContent(ar.storyAct3RecCritical);
  });

  it("renders em-dash for net sentiment when nothing is analysed", () => {
    const unanalysedSnapshot = {
      ...baseSnapshot,
      analysed: 0,
      unanalysed: 100,
      sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
      kpis: {
        total_views: null,
        total_likes: 0,
        total_comments: 100,
        engagement_rate: null,
        net_sentiment: null,
      },
    } as unknown as Snapshot;

    render(<Summary s={unanalysedSnapshot} S={ar} />);
    expect(screen.getByTestId("kpi-net-sentiment")).toHaveTextContent("—");
  });
});
