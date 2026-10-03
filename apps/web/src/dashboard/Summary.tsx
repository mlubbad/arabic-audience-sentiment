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
import { UNCLASSIFIED } from "@sentiment/contracts";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import type { Strings } from "../strings";
import type { Locale } from "../locale";
import type { Snapshot } from "./Dashboard";
import { formatPercent, n } from "./format";
import "./summary.css";

export function Summary({
  s,
  S,
  topicName,
  lang,
}: {
  s: Snapshot;
  S: Strings;
  topicName?: (key: string) => string;
  lang?: Locale;
}) {
  const effectiveLang: Locale =
    lang ?? (S.brandHomeLabel === "Audience Sentiment — home" ? "en" : "ar");
  const pos = s.sentiments.positive ?? 0;
  const neg = s.sentiments.negative ?? 0;
  const analysed = s.analysed;
  const posPct = analysed > 0 ? Math.round((pos / analysed) * 100) : 0;
  const negPct = analysed > 0 ? Math.round((neg / analysed) * 100) : 0;
  const rawNet =
    s.kpis?.net_sentiment ??
    (analysed > 0 ? ((pos - neg) / analysed) * 100 : null);
  const netScore = rawNet != null ? Math.round(rawNet) : null;
  const netSign = formatPercent(netScore, effectiveLang, { sign: true });

  let pulseBadge = S.pulseBalanced;
  let pulseTone: "positive" | "negative" | "sentiment-neutral" =
    "sentiment-neutral";
  if (netScore != null) {
    if (netScore >= 40) {
      pulseBadge = S.pulseStrongPositive;
      pulseTone = "positive";
    } else if (netScore >= 10) {
      pulseBadge = S.pulseModeratePositive;
      pulseTone = "positive";
    } else if (netScore <= -40) {
      pulseBadge = S.pulseCriticalAlert;
      pulseTone = "negative";
    } else if (netScore <= -10) {
      pulseBadge = S.pulseNegativeAttention;
      pulseTone = "negative";
    }
  }

  let act1Text = S.insightNoMatches;
  if (analysed > 0) {
    if (posPct >= negPct + 15) {
      act1Text = S.storyAct1DominantPos(posPct, negPct);
    } else if (negPct >= posPct + 15) {
      act1Text = S.storyAct1DominantNeg(negPct, posPct);
    } else {
      act1Text = S.storyAct1Balanced(posPct, negPct);
    }
  }

  const sortedTopics = Object.entries(s.topic_counts ?? {})
    .filter(([k]) => k !== UNCLASSIFIED)
    .sort((a, b) => b[1] - a[1]);
  const topTopic = sortedTopics[0];
  const topVideo = s.videos?.[0];

  let act2Text = S.storyAct2General;
  if (topTopic && topTopic[1] > 0 && analysed > 0) {
    const topicLabel = topicName ? topicName(topTopic[0]) : topTopic[0];
    const topicPct = Math.round((topTopic[1] / analysed) * 100);
    act2Text = S.storyAct2DominantTopic(topicLabel, n(topTopic[1]), topicPct);
  } else if (topVideo && topVideo.total > 0 && s.total > 0) {
    const videoPct = Math.round((topVideo.total / s.total) * 100);
    act2Text = S.storyAct2TopVideo(
      topVideo.title ?? topVideo.id,
      n(topVideo.total),
      videoPct,
    );
  }

  let act3Text = S.storyAct3RecGeneral;
  if (s.most_engaged_negative?.length > 0 || negPct >= 20) {
    act3Text = S.storyAct3RecCritical;
  } else if (posPct >= 50) {
    act3Text = S.storyAct3RecPositive;
  }

  return (
    <section className="db-section" id="rp-summary">
      <header>
        <h2>{S.secSummaryTitle}</h2>
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

      {/* Storytelling with Data: Executive Narrative Briefing */}
      {s.analysed > 0 && (
        <Card className="db-story-briefing" data-testid="story-briefing">
          <div className="db-story-header">
            <div className="db-story-title-group">
              <span className="db-story-eyebrow">{S.storyBriefingEyebrow}</span>
              <h3 className="db-story-title">{S.storyBriefingTitle}</h3>
            </div>
            <div className="db-story-gauge" data-tone={pulseTone}>
              <div className="db-story-gauge-val ui-num">{netSign}</div>
              <div className="db-story-gauge-info">
                <span className="db-story-gauge-badge">
                  <Badge tone={pulseTone}>{pulseBadge}</Badge>
                </span>
                <span className="db-story-gauge-label">
                  {S.netSentimentScoreLabel}
                </span>
              </div>
            </div>
          </div>
          <div className="db-story-acts">
            <article className="db-story-act" data-act="1">
              <h4 className="db-story-act-title">{S.storyAct1Title}</h4>
              <p className="db-story-act-body">{act1Text}</p>
            </article>
            <article className="db-story-act" data-act="2">
              <h4 className="db-story-act-title">{S.storyAct2Title}</h4>
              <p className="db-story-act-body">{act2Text}</p>
            </article>
            <article className="db-story-act" data-act="3">
              <h4 className="db-story-act-title">{S.storyAct3Title}</h4>
              <p className="db-story-act-body">{act3Text}</p>
            </article>
          </div>
        </Card>
      )}

      {/* 5 Primary Storytelling KPIs */}
      <div className="db-kpis-primary" aria-label={S.metricsLabel}>
        <Card className="db-kpi db-kpi-highlight">
          <strong className="db-kpi-value ui-num" data-testid="kpi-views">
            {s.kpis?.total_views != null ? n(s.kpis.total_views) : "—"}
          </strong>
          <span className="db-kpi-label">{S.kpiViews}</span>
          <small className="db-note">{S.kpiViewsNote}</small>
        </Card>
        <Card className="db-kpi db-kpi-highlight">
          <strong className="db-kpi-value ui-num" data-testid="total">
            {n(s.total)}
          </strong>
          <span className="db-kpi-label">{S.metricComments}</span>
          <small className="db-note">{S.metricCommentsNote}</small>
        </Card>
        <Card className="db-kpi db-kpi-highlight">
          <strong className="db-kpi-value ui-num" data-testid="kpi-likes">
            {s.kpis?.total_likes != null ? n(s.kpis.total_likes) : "—"}
          </strong>
          <span className="db-kpi-label">{S.kpiLikes}</span>
          <small className="db-note">{S.kpiLikesNote}</small>
        </Card>
        <Card className="db-kpi db-kpi-highlight">
          <strong
            className="db-kpi-value ui-num"
            data-testid="kpi-net-sentiment"
          >
            {netSign}
          </strong>
          <span className="db-kpi-label">{S.kpiNetSentiment}</span>
          <small className="db-note">{S.kpiNetSentimentNote}</small>
        </Card>
        <Card className="db-kpi db-kpi-highlight">
          <strong className="db-kpi-value ui-num" data-testid="kpi-engagement">
            {formatPercent(s.kpis?.engagement_rate, effectiveLang)}
          </strong>
          <span className="db-kpi-label">{S.kpiEngagement}</span>
          <small className="db-note">{S.kpiEngagementNote}</small>
        </Card>
      </div>

      {/* Technical and Pipeline Breakdown */}
      <div className="db-kpis-technical" aria-label={S.metricsLabel}>
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
            {s.replies != null ? n(s.replies) : "—"}
          </strong>
          <span className="db-kpi-label">{S.metricReplies}</span>
          <small className="db-note">{S.metricRepliesNote}</small>
        </Card>
        <Card className="db-kpi">
          <strong className="db-kpi-value ui-num">
            {s.unique_authors != null ? n(s.unique_authors) : "—"}
          </strong>
          <span className="db-kpi-label">{S.metricAuthors}</span>
          <small className="db-note">{S.metricAuthorsNote}</small>
        </Card>
      </div>

      {/* Actionable Steps / Recommendations */}
      {s.analysed > 0 && (
        <Card className="db-actionable-card" data-testid="actionable-steps">
          <div className="db-actionable-header">
            <span aria-hidden="true">💡</span>
            <span>{S.actionableStepsTitle}</span>
          </div>
          <ul className="db-actionable-list">
            {(negPct >= 15 ||
              (s.most_engaged_negative &&
                s.most_engaged_negative.length > 0)) && (
              <li className="db-actionable-item">
                <span className="db-actionable-num">{n(1)}</span>
                <span>{S.actionStep1Critical}</span>
              </li>
            )}
            {posPct >= 30 && (
              <li className="db-actionable-item">
                <span className="db-actionable-num">
                  {n(
                    negPct >= 15 ||
                      (s.most_engaged_negative &&
                        s.most_engaged_negative.length > 0)
                      ? 2
                      : 1,
                  )}
                </span>
                <span>{S.actionStep2Positive}</span>
              </li>
            )}
            <li className="db-actionable-item">
              <span className="db-actionable-num">
                {n(
                  (negPct >= 15 ||
                  (s.most_engaged_negative &&
                    s.most_engaged_negative.length > 0)
                    ? 1
                    : 0) +
                    (posPct >= 30 ? 1 : 0) +
                    1,
                )}
              </span>
              <span>{S.actionStep3Timing}</span>
            </li>
            <li className="db-actionable-item">
              <span className="db-actionable-num">
                {n(
                  (negPct >= 15 ||
                  (s.most_engaged_negative &&
                    s.most_engaged_negative.length > 0)
                    ? 1
                    : 0) +
                    (posPct >= 30 ? 1 : 0) +
                    2,
                )}
              </span>
              <span>{S.actionStep4Engagement}</span>
            </li>
          </ul>
        </Card>
      )}
    </section>
  );
}
