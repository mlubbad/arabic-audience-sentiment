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
import {
  AXIS_TEXT,
  GRID_LINE,
  SENTIMENT,
  UNMEASURABLE,
  VOLUME,
} from "../chartTheme";
import { barOptions, doughnutOptions } from "./chartOptions";
import { ChartFigures } from "./ChartFigures";
import { ChartEmpty } from "./PageStates";
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
  return (
    <section className="db-section" id="rp-voice">
      <header>
        <h2>{S.secVoice}</h2>
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
                <Doughnut
                  data={{
                    labels: Object.values(labels),
                    datasets: [
                      {
                        data: Object.values(s.sentiments),
                        // One scale, shared with the chips and the bars.
                        // Keyed by label so the four colours cannot drift out
                        // of step with the four counts beside them. Labels
                        // accompany every slice; colour is never the only
                        // carrier.
                        backgroundColor: (
                          Object.keys(s.sentiments) as Label[]
                        ).map((k) =>
                          s.measurable.has(k) ? SENTIMENT[k] : UNMEASURABLE,
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
              </div>
              <ul className="db-legend">
                {Object.entries(s.sentiments).map(([key, v]) => {
                  // A class the analysis cannot express is reported as
                  // unavailable, never as zero. On this channel about one
                  // comment in twenty is genuinely mixed, and the active
                  // model has no such class — so the zero was not
                  // uninformative, it was wrong.
                  const measurable = s.measurable.has(key);
                  return (
                    <li key={key}>
                      <span>
                        <span
                          className="db-swatch"
                          style={{
                            background: measurable
                              ? `var(--sentiment-${key})`
                              : "var(--border-2)",
                          }}
                          aria-hidden="true"
                        />
                        {measurable ? (
                          S.legendMeasured(
                            labels[key as Label],
                            n(v),
                            s.analysed ? Math.round((v / s.analysed) * 100) : 0,
                          )
                        ) : (
                          <span data-testid={`unmeasurable-${key}`}>
                            {S.legendUnmeasured(labels[key as Label])}
                          </span>
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
                              backgroundColor: VOLUME,
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
          <strong>{n(s.sentiments.negative)}</strong>
          <p>{S.figureNegative}</p>
        </article>
        <article className="db-figure" data-tone="positive">
          <strong>{n(s.sentiments.positive)}</strong>
          <p>{S.figurePositive}</p>
        </article>
        <article className="db-figure" data-tone="none">
          <strong>{n(s.unanalysed)}</strong>
          <p>{S.figureUnanalysed}</p>
        </article>
      </div>
    </section>
  );
}
