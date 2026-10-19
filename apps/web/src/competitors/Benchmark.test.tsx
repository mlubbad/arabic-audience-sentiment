// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Benchmark, benchmarkChartData, formatKpi } from "./Benchmark";
import { loadCompetitorBenchmark } from "../api/competitors";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import type { Strings } from "../strings";
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
function mount(S: Strings = ar) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Benchmark channel="UC1" tracked={1} S={S} />
    </QueryClientProvider>,
  );
}
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
  it("formats known KPIs consistently for both layouts", () => {
    expect(formatKpi("videos_per_week", -1.75)).toBe("-1.8");
    expect(formatKpi("views_per_video", 1234.6)).toBe("1,235");
  });
  it("renders known KPI formatting and unknown-cell reason only", async () => {
    vi.mocked(loadCompetitorBenchmark).mockResolvedValueOnce({
      days: 30,
      series: [
        {
          kind: "own",
          external_id: "UC1",
          title: "Own",
          points: [],
          kpis: {
            subscribers: 100,
            views: 12346,
            subscribers_change: 3,
            views_change: 10,
            videos_per_week: -1.75,
            views_per_video: 1234.6,
          },
        },
      ],
    });
    mount();
    await screen.findByTestId("benchmark-chart");
    const row = screen.getByRole("row", { name: /Own/ });
    expect(within(row).getByText("-1.8")).toBeInTheDocument();
    expect(within(row).getByText("1,235")).toBeInTheDocument();
    expect(within(row).getByText("100")).not.toHaveAttribute("title");
  });
  it.each([ar, en])(
    "labels each column and own row in both locales",
    async (S) => {
      mount(S);
      await screen.findByTestId("benchmark-chart");
      const table = screen.getByRole("table");
      expect(within(table).getByText("Own").closest("tr")).toHaveClass(
        "benchmark-own",
      );
      for (const title of [
        S.compSubscribersChange,
        S.compViewsPerVideo,
        S.compVideosPerWeek,
      ])
        expect(
          [...within(table).getAllByRole("columnheader")].find((h) =>
            h.textContent?.startsWith(title),
          ),
        ).toHaveTextContent(S.compCalculation);
      for (const title of [S.compSubscribers, S.compViews])
        expect(
          [...within(table).getAllByRole("columnheader")].find(
            (h) => h.textContent === `${title}${S.compFromYoutube}`,
          ),
        ).toHaveTextContent(S.compFromYoutube);
    },
  );
  it("loads 90 days and shows the history note, while 30 days hides it", async () => {
    mount();
    await screen.findByTestId("benchmark-chart");
    expect(screen.queryByText(ar.compHistory)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(ar.compWindow));
    fireEvent.click(await screen.findByRole("option", { name: "90" }));
    expect(await screen.findByText(ar.compHistory)).toBeInTheDocument();
    expect(loadCompetitorBenchmark).toHaveBeenCalledWith(
      "UC1",
      90,
      expect.anything(),
    );
  });
  it("renders unknown KPI values as em dash", async () => {
    const { container } = mount();
    expect(await screen.findByTestId("benchmark-chart")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(container.querySelector(".benchmark-table-wrap td")).toHaveAttribute(
      "title",
      ar.compNoStats,
    );
    expect(container.querySelector(".benchmark-cards dd")).toHaveAttribute(
      "title",
      ar.compNoStats,
    );
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
