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
import type { Snapshot } from "./Dashboard";
import { n } from "./format";
import "./summary.css";

export function Summary({
  s,
  S,
  topicName,
}: {
  s: Snapshot;
  S: Strings;
  topicName?: (key: string) => string;
}) {
  const pos = s.sentiments.positive ?? 0;
  const neg = s.sentiments.negative ?? 0;
  const analysed = s.analysed;
  const posPct = analysed > 0 ? Math.round((pos / analysed) * 100) : 0;
  const negPct = analysed > 0 ? Math.round((neg / analysed) * 100) : 0;
  const netScore =
    analysed > 0 ? Math.round(((pos - neg) / analysed) * 100) : 0;
  const netSign = netScore > 0 ? `+${netScore}٪` : `${netScore}٪`;

  let pulseBadge = S.pulseBalanced;
  let pulseTone: "positive" | "negative" | "sentiment-neutral" =
    "sentiment-neutral";
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
