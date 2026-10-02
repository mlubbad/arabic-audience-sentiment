/**
 * Audience voice: the sentiment donut and the topics bar, in Cards on the
 * shared grid.
 *
 * Moved out of `Dashboard.tsx`'s `#rp-voice` section verbatim — the chart
 * `data` objects, the sentiment colour rule (a class the analysis cannot
 * express reads as unmeasurable, never as zero) and the three-figure row
 * underneath are unchanged. Only the wrapping classes move from `rp-*` to
 * `db-*` and onto `ui/Card`.
 */
import { Bar, Doughnut } from "react-chartjs-2";
import { UNCLASSIFIED, type Label } from "@sentiment/contracts";
import { Card } from "../ui/Card";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { AXIS_TEXT, GRID_LINE, SENTIMENT, VOLUME } from "../chartTheme";
import { barOptions, doughnutOptions } from "./chartOptions";
import { ChartFigures } from "./ChartFigures";
import { ChartEmpty } from "../pageStates/PageStates";
import { n } from "./format";
import "./voice.css";

export function Voice({
  s,
  S,
  labels,
  topicName,
}: {
  s: Snapshot;
  S: Strings;
  labels: Strings["labels"];
  /** The same lookup the comments table and its review dialog use for a
   *  topic's name in the reader's language — reused here rather than
   *  re-deriving `name_ar`/`name_en` from a locale, so there is one place on
   *  the page that decides what a topic key is called. */
  topicName: (key: string) => string;
}) {
  const pos = s.sentiments.positive ?? 0;
  const neg = s.sentiments.negative ?? 0;
  const netScore =
    s.analysed > 0 ? Math.round(((pos - neg) / s.analysed) * 100) : 0;
  const netSign = netScore > 0 ? `+${netScore}٪` : `${netScore}٪`;

  const isMeasurable = (k: Label) =>
    s.measurable ? s.measurable.has(k) : true;
  const measurableKeys = (Object.keys(s.sentiments) as Label[]).filter(
    isMeasurable,
  );

  return (
    <section className="db-section" id="rp-voice">
      <header>
        <h2>{S.secVoiceTitle}</h2>
        <p className="db-lead">{S.voiceLead(n(s.analysed))}</p>
      </header>
      <div className="db-grid db-grid--2">
        <Card>
          <h3 className="db-card-title">{S.sentimentsTitle}</h3>
          {s.analysed > 0 ? (
            <>
              <div
                className="db-chart db-chart--donut"
                aria-hidden="true"
                data-testid="chart-donut"
              >
                <div className="db-donut-wrap">
                  <Doughnut
                    data={{
                      labels: measurableKeys.map((k) => labels[k]),
                      datasets: [
                        {
                          data: measurableKeys.map((k) => s.sentiments[k] ?? 0),
                          // One scale, shared with the chips and the bars.
                          // Keyed by label so the colours cannot drift out
                          // of step with the counts beside them.
                          backgroundColor: measurableKeys.map(
                            (k) => SENTIMENT[k],
                          ),
                          // White, the card's own colour: the gap is what keeps
                          // two touching slices two.
                          borderColor: "#ffffff",
                          borderWidth: 2,
                        },
                      ],
                    }}
                    options={doughnutOptions}
                  />
                  <div className="db-donut-center">
                    <span className="db-donut-center-val ui-num">
                      {netSign}
                    </span>
                    <span className="db-donut-center-lbl">
                      {S.donutCenterNet}
                    </span>
                  </div>
                </div>
              </div>
              <ul className="db-legend">
                {measurableKeys.map((key) => {
                  const v = s.sentiments[key] ?? 0;
                  return (
                    <li key={key}>
                      <span>
                        <span
                          className="db-swatch"
                          style={{
                            background: `var(--sentiment-${key})`,
                          }}
                          aria-hidden="true"
                        />
                        {S.legendMeasured(
                          labels[key],
                          n(v),
                          s.analysed ? Math.round((v / s.analysed) * 100) : 0,
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <ChartEmpty>
              <strong>{S.noLabelsStrong}</strong>
              {S.noLabelsLead}
            </ChartEmpty>
          )}
        </Card>
        <Card data-testid="topics-card">
          <h3 className="db-card-title">{S.topicsTitle}</h3>
          {/* Real verdicts only: the buckets are the taxonomy the workspace
              chose, counted under its active topic model, and a human
              correction wins over the model's verdict by the same rule the
              sentiment chart uses. Until a model has run there is nothing to
              draw, and the card says so rather than clustering by keyword
              and calling that analysis. */}
          {!s.active_topic_key ? (
            <ChartEmpty>
              <strong>{S.topicsNotRunStrong}</strong>
              {S.topicsNotRunLead}
            </ChartEmpty>
          ) : (
            (() => {
              const buckets = s.topics
                .filter((t) => !t.retired)
                .map((t) => ({
                  key: t.key,
                  label: topicName(t.key),
                  count: s.topic_counts[t.key] ?? 0,
                }))
                .filter((b) => b.count > 0)
                .sort(
                  (a, b) =>
                    b.count - a.count || a.key.localeCompare(b.key, "en"),
                );
              const unclassified = s.topic_counts[UNCLASSIFIED] ?? 0;
              return (
                <>
                  {buckets.length > 0 && (
                    <div
                      className="db-chart"
                      aria-hidden="true"
                      data-testid="chart-topics"
                    >
                      <Bar
                        data={{
                          labels: buckets.map((b) => b.label),
                          datasets: [
                            {
                              data: buckets.map((b) => b.count),
                              backgroundColor: buckets.map((_, idx) =>
                                idx === 0 ? VOLUME : "rgba(75, 52, 201, 0.4)",
                              ),
                              borderRadius: 4,
                            },
                          ],
                        }}
                        options={{
                          ...barOptions,
                          indexAxis: "y" as const,
                          // Horizontal, so the count axis is x: the shared
                          // options pin whole numbers on y, and a third of a
                          // comment is not a tick.
                          scales: {
                            x: {
                              beginAtZero: true,
                              ticks: { color: AXIS_TEXT, precision: 0 },
                              grid: { color: GRID_LINE },
                            },
                            y: {
                              ticks: { color: AXIS_TEXT },
                              grid: { display: false },
                            },
                          },
                        }}
                      />
                    </div>
                  )}
                  <ChartFigures
                    caption={S.topicsCaption}
                    unit={S.topicsUnit}
                    buckets={buckets}
                  />
                  {/* Not a bucket: an unclassified comment has no topic, and
                      drawing it as one would make the gap look like a
                      theme. */}
                  {unclassified > 0 && (
                    <p className="db-note" data-testid="topics-unclassified">
                      {S.topicsUnclassified(n(unclassified))}
                    </p>
                  )}
                </>
              );
            })()
          )}
        </Card>
      </div>
      {/* Three figures, and the section's own prose says one of them is the
          one to act on — "وهي التي تستحق قراءة نصّها". They were three
          identical filled indigo blocks with a glow, each shouting equally,
          directly under a donut that had just said the same numbers in the
          sentiment colours. Emphasis spent three times is emphasis spent
          nowhere; and one fact wearing two colour languages eight pixels
          apart is the reader's problem, not the palette's. The lead figure
          is lead-sized, the other two recede, and each number wears the
          colour its slice wears above. */}
      <div className="db-figures-row">
        <article className="db-figure" data-tone="negative">
          <strong>{n(s.sentiments.negative ?? 0)}</strong>
          <p>{S.figureNegative}</p>
        </article>
        <article className="db-figure" data-tone="positive">
          <strong>{n(s.sentiments.positive ?? 0)}</strong>
          <p>{S.figurePositive}</p>
        </article>
        <article className="db-figure" data-tone="none">
          <strong>{n(s.unanalysed ?? 0)}</strong>
          <p>{S.figureUnanalysed}</p>
        </article>
      </div>
    </section>
  );
}
