import { useQuery } from "@tanstack/react-query";
import { Line } from "react-chartjs-2";
import { useState } from "react";
import {
  competitorKeys,
  loadCompetitorBenchmark,
  type CompetitorBenchmark,
} from "../api/competitors";
import type { Strings } from "../strings";
import { n } from "../dashboard/format";
import { lineOptions } from "../dashboard/chartOptions";
import type { ChartData } from "chart.js";
import { Labelled } from "../ui/Labelled";
import { SelectItem } from "../ui/Select";
import { Button } from "../ui/Button";
import "./benchmark.css";

const colors = [
  "#6558d3",
  "#d75b72",
  "#159b83",
  "#d99024",
  "#3985cf",
  "#ad5bb8",
];
export function benchmarkChartData(
  series: CompetitorBenchmark["series"],
  metric: "subscriber_count" | "view_count",
): ChartData<"line", (number | null)[], string> {
  const labels = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p.day))),
  ].sort();
  return {
    labels,
    datasets: series.map((s, i) => ({
      label: s.title,
      data: labels.map(
        (day) => s.points.find((p) => p.day === day)?.[metric] ?? null,
      ),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length],
      spanGaps: false,
    })),
  };
}
export function formatKpi(key: string, value: number | null): string {
  if (value == null) return "—";
  if (key === "videos_per_week") return n(Number(value.toFixed(1)));
  if (key === "views_per_video") return n(Math.round(value));
  return n(value);
}
export function Benchmark({
  channel,
  tracked,
  S,
}: {
  channel: string;
  tracked: number;
  S: Strings;
}) {
  const [days, setDays] = useState(30),
    [metric, setMetric] = useState<"subscriber_count" | "view_count">(
      "subscriber_count",
    );
  const query = useQuery({
    queryKey: [...competitorKeys.channel(channel), "benchmark", days],
    queryFn: ({ signal }) => loadCompetitorBenchmark(channel, days, signal),
    enabled: tracked > 0,
  });
  if (!tracked)
    return (
      <section className="competitor-benchmark">
        <h2>{S.compBenchmark}</h2>
        <p>{S.compBenchmarkEmpty}</p>
      </section>
    );
  if (query.isPending) return <p>{S.compBenchmarkLoading}</p>;
  if (query.isError || !query.data)
    return (
      <p role="alert">
        {S.compError}: {query.error?.message}
      </p>
    );
  const series = query.data.series;
  const data = benchmarkChartData(series, metric);
  const cols = [
    { key: "subscribers", title: S.compSubscribers, calculated: false },
    {
      key: "subscribers_change",
      title: S.compSubscribersChange,
      calculated: true,
    },
    { key: "views", title: S.compViews, calculated: false },
    { key: "views_per_video", title: S.compViewsPerVideo, calculated: true },
    { key: "videos_per_week", title: S.compVideosPerWeek, calculated: true },
  ] as const;
  return (
    <section className="competitor-benchmark">
      <header>
        <h2>{S.compBenchmark}</h2>
        <Labelled
          id="benchmark-window"
          label={S.compWindow}
          value={String(days)}
          onValueChange={(v) => setDays(Number(v))}
        >
          {[7, 30, 90].map((d) => (
            <SelectItem key={d} value={String(d)}>
              {d}
            </SelectItem>
          ))}
        </Labelled>
      </header>
      {days > 30 && <p>{S.compHistory}</p>}
      <p>
        {S.compFromYoutube} · {S.compCalculation}
      </p>
      <div className="benchmark-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{S.compChannel}</th>
              {cols.map((c) => (
                <th key={c.key}>
                  {c.title}
                  <small
                    title={c.calculated ? S.compCalculation : S.compFromYoutube}
                  >
                    {c.calculated ? S.compCalculation : S.compFromYoutube}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr
                key={`${s.kind}-${s.external_id}`}
                className={s.kind === "own" ? "benchmark-own" : ""}
              >
                <th>{s.title}</th>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    title={
                      s.kpis[c.key] == null
                        ? c.key.endsWith("_per_week")
                          ? S.compLessWeek
                          : c.key.endsWith("_per_video")
                            ? S.compNoVideos
                            : c.key.endsWith("_change")
                              ? S.compNeedsTwoDays
                              : S.compNoStats
                        : undefined
                    }
                  >
                    {formatKpi(c.key, s.kpis[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="benchmark-cards">
        {series.map((s) => (
          <article key={`${s.kind}-${s.external_id}`}>
            <h3>{s.title}</h3>
            <dl>
              {cols.map((c) => (
                <div key={c.key}>
                  <dt>{c.title}</dt>
                  <dd
                    title={
                      s.kpis[c.key] == null
                        ? c.key.endsWith("_per_week")
                          ? S.compLessWeek
                          : c.key.endsWith("_per_video")
                            ? S.compNoVideos
                            : c.key.endsWith("_change")
                              ? S.compNeedsTwoDays
                              : S.compNoStats
                        : undefined
                    }
                  >
                    {formatKpi(c.key, s.kpis[c.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <nav aria-label={S.compChartMetric}>
        <Button
          type="button"
          aria-pressed={metric === "subscriber_count"}
          onClick={() => setMetric("subscriber_count")}
        >
          {S.compSubscribers}
        </Button>
        <Button
          type="button"
          aria-pressed={metric === "view_count"}
          onClick={() => setMetric("view_count")}
        >
          {S.compViews}
        </Button>
      </nav>
      <div className="benchmark-chart">
        <Line data={data} options={{ ...lineOptions, spanGaps: false }} />
      </div>
    </section>
  );
}
