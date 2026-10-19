// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Benchmark, benchmarkChartData } from "./Benchmark";
import { loadCompetitorBenchmark } from "../api/competitors";
import { ar } from "../strings/ar";
vi.mock("../api/competitors", () => ({
  competitorKeys: { channel: (id: string) => [id] },
  loadCompetitorBenchmark: vi.fn().mockResolvedValue({
    days: 30,
    series: [
      {
        kind: "own",
        external_id: "UC1",
        title: "Own",
        points: [],
        kpis: {
          subscribers: null,
          views: null,
          subscribers_change: null,
          views_change: null,
          videos_per_week: null,
          views_per_video: null,
        },
      },
    ],
  }),
}));
vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="benchmark-chart" />,
}));
afterEach(cleanup);
describe("Benchmark", () => {
  it("shows empty state when there are no tracked competitors", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Benchmark channel="UC1" tracked={0} S={ar} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(ar.compBenchmarkEmpty)).toBeInTheDocument();
    expect(loadCompetitorBenchmark).not.toHaveBeenCalled();
  });
  it("renders unknown KPI values as em dash", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Benchmark channel="UC1" tracked={1} S={ar} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("benchmark-chart")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("builds null gaps and disables chart gap spanning", () => {
    const result = benchmarkChartData(
      [
        {
          kind: "own",
          external_id: "UC1",
          title: "Own",
          points: [
            {
              day: "2026-10-01",
              subscriber_count: 10,
              view_count: 100,
              video_count: 2,
            },
            {
              day: "2026-10-03",
              subscriber_count: 12,
              view_count: 120,
              video_count: 2,
            },
          ],
          kpis: {
            subscribers: 12,
            views: 120,
            subscribers_change: 2,
            views_change: 20,
            videos_per_week: null,
            views_per_video: 60,
          },
        },
        {
          kind: "competitor",
          external_id: "UC2",
          title: "Other",
          points: [
            {
              day: "2026-10-02",
              subscriber_count: 5,
              view_count: 50,
              video_count: 1,
            },
          ],
          kpis: {
            subscribers: 5,
            views: 50,
            subscribers_change: null,
            views_change: null,
            videos_per_week: null,
            views_per_video: 50,
          },
        },
      ],
      "view_count",
    );
    expect(result.datasets[0]!.data).toEqual([100, null, 120]);
    expect(result.datasets[0]!.spanGaps).toBe(false);
  });
});
