// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import type { Snapshot } from "./Dashboard";
import { Voice } from "./Voice";

vi.mock("react-chartjs-2", () => ({
  Doughnut: vi.fn(
    (props: {
      data: { labels: string[]; datasets: Array<{ data: number[] }> };
    }) => (
      <div
        data-testid="mock-doughnut"
        data-labels={JSON.stringify(props.data.labels)}
        data-values={JSON.stringify(props.data.datasets[0].data)}
      />
    ),
  ),
  Bar: vi.fn(() => <div data-testid="mock-bar" />),
}));

describe("Voice - Conditional Mixed Sentiment Display", () => {
  it("does NOT display mixed in Doughnut chart or legend when model does not support mixed", () => {
    const sWithoutMixed = {
      analysed: 100,
      unanalysed: 0,
      sentiments: { positive: 60, negative: 30, neutral: 10, mixed: 0 },
      measurable: new Set(["positive", "negative", "neutral"]),
      topic_counts: {},
      videos: [],
    } as unknown as Snapshot;

    render(
      <Voice
        s={sWithoutMixed}
        S={ar}
        labels={ar.labels}
        topicName={(k) => k}
      />,
    );

    const doughnut = screen.getByTestId("mock-doughnut");
    const labels = JSON.parse(doughnut.getAttribute("data-labels") || "[]");
    expect(labels).toContain(ar.labels.positive);
    expect(labels).toContain(ar.labels.negative);
    expect(labels).toContain(ar.labels.neutral);
    expect(labels).not.toContain(ar.labels.mixed);

    // Legend should not have any text mentioning mixed
    const legend = document.querySelector(".db-legend");
    expect(legend).toBeInTheDocument();
    expect(legend).not.toHaveTextContent(ar.labels.mixed);
    expect(screen.queryByTestId("unmeasurable-mixed")).not.toBeInTheDocument();
  });

  it("DOES display mixed in Doughnut chart and legend when model supports mixed", () => {
    const sWithMixed = {
      analysed: 100,
      unanalysed: 0,
      sentiments: { positive: 50, negative: 20, neutral: 20, mixed: 10 },
      measurable: new Set(["positive", "negative", "neutral", "mixed"]),
      topic_counts: {},
      videos: [],
    } as unknown as Snapshot;

    render(
      <Voice s={sWithMixed} S={ar} labels={ar.labels} topicName={(k) => k} />,
    );

    const doughnut = screen.getByTestId("mock-doughnut");
    const labels = JSON.parse(doughnut.getAttribute("data-labels") || "[]");
    expect(labels).toContain(ar.labels.positive);
    expect(labels).toContain(ar.labels.negative);
    expect(labels).toContain(ar.labels.neutral);
    expect(labels).toContain(ar.labels.mixed);

    // Legend should have mixed
    const legend = document.querySelector(".db-legend");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent(ar.labels.mixed);
    expect(legend).toHaveTextContent("10");
  });
});
