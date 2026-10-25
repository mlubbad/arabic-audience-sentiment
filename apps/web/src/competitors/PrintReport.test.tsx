// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CompetitorBenchmark, Suggestions } from "../api/competitors";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import { PrintReport } from "./PrintReport";

afterEach(cleanup);

const baseSuggestions: Suggestions = {
  channel: {
    id: "UC_SOURCE",
    title: "قناة الشرق للأخبار",
    handle: "@asharqnews",
    subscriber_count: 1200000,
  },
  limit: 5,
  tracked_count: 1,
  candidates: [
    {
      external_id: "UC_CAND_1",
      title: "قناة العربية",
      handle: "@alarabiya",
      sources: ["featured"],
      status: "tracked",
      subscriber_count: 2500000,
      view_count: null,
      video_count: null,
      profile_observed_at: "2026-10-24T10:00:00Z",
      score: 0.84,
      tier: "direct",
      reasons: [{ kind: "shared_topics", value: 4 }, { kind: "same_language" }],
    },
    {
      external_id: "UC_CAND_2",
      title: "قناة ثانية",
      handle: null,
      sources: ["manual"],
      status: null,
      subscriber_count: null,
      view_count: null,
      video_count: null,
      profile_observed_at: null,
      score: null,
      tier: null,
      reasons: [],
    },
  ],
};

const sampleBenchmark: CompetitorBenchmark = {
  days: 30,
  series: [
    {
      kind: "own",
      external_id: "UC_SOURCE",
      title: "قناة الشرق للأخبار",
      points: [],
      kpis: {
        subscribers: 1200000,
        views: 80000000,
        subscribers_change: 15000,
        views_change: 2000000,
        videos_per_week: 14.2,
        views_per_video: null,
      },
    },
  ],
};

describe("PrintReport (WO-33)", () => {
  it.each([["ar", ar] as const, ["en", en] as const])(
    "renders in %s with the provenance line, tier label (not raw key), and em-dash unknowns",
    (lang, S) => {
      const { container } = render(
        <PrintReport
          data={baseSuggestions}
          benchmark={sampleBenchmark}
          S={S}
          lang={lang}
          exportedAt="2026-10-24T12:00:00Z"
        />,
      );
      const root = container.querySelector(".competitor-print")!;
      expect(root).toHaveAttribute("lang", lang);
      expect(root).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      expect(
        within(root as HTMLElement).getByText(S.compProvenanceNote),
      ).toBeInTheDocument();
      // Renders the localized tier label rather than the raw key "direct"
      expect(
        within(root as HTMLElement).getByText(S.compTier_direct),
      ).toBeInTheDocument();
      expect(
        within(root as HTMLElement).queryByText("direct"),
      ).not.toBeInTheDocument();
      // Unknown values print "—"
      expect(
        within(root as HTMLElement).getAllByText("—").length,
      ).toBeGreaterThan(0);
      // Benchmark table appears when tracked_count > 0
      expect(
        within(root as HTMLElement).getByRole("heading", {
          name: new RegExp(S.compBenchmark),
        }),
      ).toBeInTheDocument();
    },
  );

  it("hides the benchmark table when nothing is tracked", () => {
    render(
      <PrintReport
        data={{ ...baseSuggestions, tracked_count: 0 }}
        benchmark={sampleBenchmark}
        S={ar}
        lang="ar"
        exportedAt="2026-10-24T12:00:00Z"
      />,
    );
    expect(
      screen.queryByRole("heading", { name: new RegExp(ar.compBenchmark) }),
    ).not.toBeInTheDocument();
  });
});
