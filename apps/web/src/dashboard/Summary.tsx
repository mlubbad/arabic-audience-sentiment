/**
 * The headline counts, on the tokens.
 *
 * Five KPI tiles and four insight sentences — unchanged in count and
 * arithmetic from the inline section, now on `ui/Card` inside the shared
 * `.db-grid`. `s.channel_own_comments` is deliberately read from the
 * *unfiltered* input (see `snapshot.ts`) and stays visible beside the lead
 * sentence, or every other total on this page would look inconsistent with
 * the one shown here.
 */
import { Card } from "../ui/Card";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { n } from "./format";
import "./summary.css";

export function Summary({ s, S }: { s: Snapshot; S: Strings }) {
  return (
    <section className="db-section" id="rp-summary">
      <header>
        <h2>{S.secSummary}</h2>
        <p className="db-lead">
          {S.summaryLead}
          {s.channel_own_comments > 0 && (
            <>
              {" "}
              <span data-testid="owner-excluded">
                {S.ownerExcluded(n(s.channel_own_comments))}
              </span>
            </>
          )}
        </p>
      </header>
      <div className="db-grid" aria-label={S.metricsLabel}>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num" data-testid="total">
            {n(s.total)}
          </strong>
          <span className="db-kpi-label">{S.metricComments}</span>
          <small className="db-note">{S.metricCommentsNote}</small>
        </Card>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num">{n(s.analysed)}</strong>
          <span className="db-kpi-label">{S.metricAnalysed}</span>
          <small className="db-note">{S.metricAnalysedNote}</small>
        </Card>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num">{n(s.unanalysed)}</strong>
          <span className="db-kpi-label">{S.metricUnanalysed}</span>
          <small className="db-note">{S.metricUnanalysedNote}</small>
        </Card>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num" data-testid="replies-count">
            {n(s.replies)}
          </strong>
          <span className="db-kpi-label">{S.metricReplies}</span>
          <small className="db-note">{S.metricRepliesNote}</small>
        </Card>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num">{n(s.unique_authors)}</strong>
          <span className="db-kpi-label">{S.metricAuthors}</span>
          {/* Counted by channel id. Rows whose author was purged are not
              countable as people and are excluded rather than guessed at. */}
          <small className="db-note">{S.metricAuthorsNote}</small>
        </Card>
      </div>
      <div className="db-grid" style={{ marginTop: "var(--space-4)" }}>
        {/* Named, not numbered: these four are independent readings — how
            much was analysed, how much is audience-to-audience, how
            concentrated the talk is, how much of it can be placed in time —
            not steps in a sequence. */}
        <Card className="db-insight">
          <p className="db-insight-tag">{S.insightAnalysis}</p>
          <p>
            {s.total > 0
              ? S.insightAnalysed(Math.round((s.analysed / s.total) * 100))
              : S.insightNoMatches}
          </p>
        </Card>
        <Card className="db-insight">
          <p className="db-insight-tag">{S.insightReplies}</p>
          <p>
            {s.total > 0
              ? S.insightRepliesShare(Math.round((s.replies / s.total) * 100))
              : S.insightRepliesNone}
          </p>
        </Card>
        <Card className="db-insight">
          <p className="db-insight-tag">{S.insightConcentration}</p>
          <p>
            {s.videos.length > 0
              ? S.insightTopVideo(
                  n(s.videos[0].total),
                  n(s.total),
                  Math.round((s.videos[0].total / s.total) * 100),
                )
              : S.insightNoVideo}
          </p>
        </Card>
        <Card className="db-insight">
          <p className="db-insight-tag">{S.insightDates}</p>
          <p>
            {s.unknown_dates > 0
              ? S.insightUndated(n(s.unknown_dates))
              : S.insightAllDated}
          </p>
        </Card>
      </div>
    </section>
  );
}
