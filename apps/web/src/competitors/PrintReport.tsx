import type { CompetitorBenchmark, Suggestions } from "../api/competitors";
import { n } from "../dashboard/format";
import { displayDate } from "../i18n";
import type { Locale } from "../locale";
import type { Strings } from "../strings";
import { formatKpi } from "./Benchmark";
import { reasonLabel, tierLabel } from "./CandidateCard";
import "./print.css";

export function PrintReport({
  data,
  benchmark,
  S,
  lang,
  exportedAt = new Date().toISOString(),
}: {
  data: Suggestions;
  benchmark?: CompetitorBenchmark | null;
  S: Strings;
  lang: Locale;
  exportedAt?: string;
}) {
  const channelName =
    data.channel.title || data.channel.handle || data.channel.id;
  const trackedSentence = `${S.compTracked}: ${data.tracked_count} ${S.compOf} ${
    data.limit == null ? S.compUnlimited : data.limit
  }`;
  const benchmarkCols = [
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
    <section
      className="competitor-print"
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      aria-label={S.compExportPdf}
    >
      <header>
        <h1>{S.titleCompetitors}</h1>
        <p>{channelName}</p>
        <p>{displayDate(exportedAt, lang)}</p>
        <p>{trackedSentence}</p>
        <p>{S.compProvenanceNote}</p>
      </header>

      <section>
        <h2>{S.compSuggestions}</h2>
        <table>
          <thead>
            <tr>
              <th>{S.compChannel}</th>
              <th>{S.compTierLabel}</th>
              <th>
                {S.compMatch} ({S.compEstimate})
              </th>
              <th>
                {S.compSubscribers} ({S.compFromYoutube})
              </th>
              <th>{S.compReasons}</th>
            </tr>
          </thead>
          <tbody>
            {data.candidates.map((c) => {
              const title = c.title || c.handle || c.external_id;
              const reasonsText = c.reasons
                .map((r) => reasonLabel(r, S))
                .filter(Boolean)
                .join(" · ");
              return (
                <tr key={c.external_id}>
                  <td>{title}</td>
                  <td>{tierLabel(c.tier, S) ?? "—"}</td>
                  <td>
                    {c.score == null
                      ? "—"
                      : `${n(Math.round(c.score * 100))}% (${S.compEstimate})`}
                  </td>
                  <td>
                    {c.subscriber_count == null ? "—" : n(c.subscriber_count)}
                  </td>
                  <td>{reasonsText || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {data.tracked_count > 0 && benchmark && benchmark.series.length > 0 && (
        <section>
          <h2>
            {S.compBenchmark} ({benchmark.days})
          </h2>
          <table>
            <thead>
              <tr>
                <th>{S.compChannel}</th>
                {benchmarkCols.map((col) => (
                  <th key={col.key}>
                    {col.title} (
                    {col.calculated ? S.compCalculation : S.compFromYoutube})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmark.series.map((s) => (
                <tr key={`${s.kind}-${s.external_id}`}>
                  <th>{s.title}</th>
                  {benchmarkCols.map((col) => (
                    <td key={col.key}>{formatKpi(col.key, s.kpis[col.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </section>
  );
}
