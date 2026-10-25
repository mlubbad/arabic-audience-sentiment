// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import type { Snapshot } from "./Dashboard";
import { Timing } from "./Timing";
import type { Bucketed } from "../analytics";

const emptyBucketed: Bucketed = {
  buckets: [],
  unplaceable: 0,
};

const baseSnapshot = {
  unknown_dates: 0,
} as unknown as Snapshot;

describe("Timing spike attributions card", () => {
  it("renders succeeded spike attributions with Arabic headline, summary, and verified citation links", () => {
    render(
      <Timing
        s={baseSnapshot}
        S={ar}
        hours={emptyBucketed}
        weekdays={emptyBucketed}
        weeks={emptyBucketed}
        spikeAttributions={[
          {
            id: "00000000-0000-4000-8000-000000000010",
            channel_id: "00000000-0000-4000-8000-000000000001",
            from_date: "2026-10-15",
            to_date: "2026-10-18",
            dominant_sentiment: "mixed",
            query: "الجزيرة 360 وثائقي",
            scope: "news",
            status: "succeeded",
            headline_ar: "إطلاق سلسلة وثائقية جديدة على منصة الجزيرة 360",
            summary_ar:
              "تزامنت طفرة التعليقات المختلطة مع نقاش واسع حول الحلقة الافتتاحية.",
            citations: [
              {
                url: "https://aljazeera360.com/doc1",
                published_date: "2026-10-16",
              },
            ],
            error_code: null,
            computed_at: "2026-10-20T12:00:00Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            channel_id: "00000000-0000-4000-8000-000000000001",
            from_date: "2026-10-01",
            to_date: "2026-10-02",
            dominant_sentiment: "negative",
            query: "انقطاع",
            scope: "news",
            status: "failed",
            headline_ar: null,
            summary_ar: null,
            citations: [],
            error_code: "seltz_quota_exhausted",
            computed_at: "2026-10-20T12:00:00Z",
          },
        ]}
      />,
    );

    const card = screen.getByTestId("timing-spike-attributions");
    expect(card).toBeInTheDocument();
    expect(
      screen.getByText("إطلاق سلسلة وثائقية جديدة على منصة الجزيرة 360"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "تزامنت طفرة التعليقات المختلطة مع نقاش واسع حول الحلقة الافتتاحية.",
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /المصدر الموثق/ });
    expect(link).toHaveAttribute("href", "https://aljazeera360.com/doc1");
  });
});
