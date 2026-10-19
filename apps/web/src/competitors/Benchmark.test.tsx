// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Benchmark } from "./Benchmark";
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
});
