/**
 * The comments table — `ui/Table` at desk width, a stacked `Card`+`dl` at
 * phone width, same data and the same test ids either way. `topic-chip`
 * and the two correction buttons are per-row, not per-layout: a reader who
 * resizes past 760px must still find them, so both branches build them
 * from the same `SentimentChip`/`TopicChip`/`RowActions` pieces rather
 * than two hand-kept copies that could drift.
 *
 * The confidence score beside an unreviewed label is read once, here, and
 * shared by both branches (`confidencePct`) — the cards above this table
 * (`Comments.tsx`) compute the very same number from the very same fields,
 * so it is exported rather than reimplemented a second time.
 */
import type { Label, LabelledComment } from "@sentiment/contracts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { Badge, type BadgeProps } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import type { Locale } from "../locale";
import { commentText, displayDate } from "../i18n";
import { useMediaQuery } from "../ui/useMediaQuery";
import { formatPercent, n } from "./format";
import "./comments.css";

/** The sentiment scale's own tone, never `neutral`'s badge default — same
 *  map `Hero.tsx` uses for the split above the fold. */
const SENTIMENT_TONE: Record<Label, BadgeProps["tone"]> = {
  positive: "positive",
  negative: "negative",
  mixed: "sentiment-mixed",
  neutral: "sentiment-neutral",
};

/** The confidence a still-unreviewed label carries, rounded to a whole
 *  percent — `null` once a human has ruled, or when the model never
 *  scored the class it predicted. */
export function confidencePct(c: LabelledComment): number | null {
  if (!c.label || c.reviewed) return null;
  const score = c.prediction?.class_scores?.[c.label];
  return typeof score === "number" ? Math.round(score * 100) : null;
}

function SentimentChip({
  c,
  labels,
  lang,
  noLabelText,
}: {
  c: LabelledComment;
  labels: Record<Label, string>;
  lang: Locale;
  noLabelText: string;
}) {
  const score = confidencePct(c);
  return (
    <Badge
      tone={c.label ? SENTIMENT_TONE[c.label] : "neutral"}
      className={!c.label ? "db-chip-unanalysed" : undefined}
    >
      {c.label ? labels[c.label] : noLabelText}
      {score !== null && (
        <span className="db-chip-score">{formatPercent(score, lang)}</span>
      )}
    </Badge>
  );
}

/** The topic beside the sentiment, once a model has run. "No topic" is
 *  said in words so an empty cell is not mistaken for an unclassified
 *  one: the two mean different things. */
function TopicChip({
  c,
  S,
  topicName,
}: {
  c: LabelledComment;
  S: Strings;
  topicName: (key: string) => string;
}) {
  return (
    <Badge
      tone="neutral"
      className="db-chip-topic"
      data-topic={c.topic ?? "none"}
      data-testid="topic-chip"
    >
      {c.topic ? topicName(c.topic) : S.topicNone}
      {c.topic_reviewed && <small>{S.topicReviewed}</small>}
    </Badge>
  );
}

function RowActions({
  c,
  S,
  activeTopicKey,
  onReview,
  onTopicReview,
}: {
  c: LabelledComment;
  S: Strings;
  activeTopicKey: string;
  onReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
  onTopicReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
}) {
  const who = c.author_name ?? S.purgedAuthor;
  return (
    <div className="db-row-actions">
      <Button
        variant="ghost"
        size="sm"
        className="db-action-btn"
        onClick={(e) => onReview(c, e.currentTarget)}
        aria-label={S.correctLabelFor(who)}
      >
        {S.correct}
      </Button>
      {activeTopicKey && (
        <Button
          variant="ghost"
          size="sm"
          className="db-action-btn"
          onClick={(e) => onTopicReview(c, e.currentTarget)}
          aria-label={S.correctTopicFor(who)}
        >
          {S.correctTopic}
        </Button>
      )}
    </div>
  );
}

export function CommentsTable({
  s,
  S,
  lang,
  labels,
  topicName,
  onReview,
  onTopicReview,
}: {
  s: Snapshot;
  S: Strings;
  lang: Locale;
  labels: Record<Label, string>;
  topicName: (key: string) => string;
  onReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
  onTopicReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
}) {
  const stacked = useMediaQuery("(max-width: 760px)");
  if (stacked) {
    return (
      <div className="db-comments-cards">
        {s.comments.map((c) => (
          <Card key={c.id} className="db-comment-row">
            <h3 className="db-card-title">
              <div className="db-comment-author-cell">
                {c.author_profile_image_url && (
                  <img
                    src={c.author_profile_image_url}
                    alt=""
                    className="db-comment-avatar"
                    loading="lazy"
                  />
                )}
                <div className="db-comment-author-info-table">
                  {c.author_channel_url ? (
                    <a
                      href={c.author_channel_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="db-comment-author-link"
                    >
                      <bdi>{c.author_name ?? S.purgedAuthor}</bdi>
                    </a>
                  ) : (
                    <bdi>{c.author_name ?? S.purgedAuthor}</bdi>
                  )}
                  {c.is_reply && <small>{S.replyTag}</small>}
                  {c.reply_count != null && c.reply_count > 0 && (
                    <small className="db-comment-replies-badge">
                      ({S.countReplies(n(c.reply_count))})
                    </small>
                  )}
                </div>
              </div>
            </h3>
            <dl className="db-comment-dl">
              <div>
                <dt>{S.colComment}</dt>
                <dd>{commentText(c, S)}</dd>
              </div>
              <div>
                <dt>{S.colSentiment}</dt>
                <dd>
                  <SentimentChip
                    c={c}
                    labels={labels}
                    lang={lang}
                    noLabelText={S.unanalysedOrOld}
                  />
                  {c.reviewed && <small>{S.humanReview}</small>}
                  {s.active_topic_key && (
                    <TopicChip c={c} S={S} topicName={topicName} />
                  )}
                </dd>
              </div>
              <div>
                <dt>{S.colDate}</dt>
                <dd>{displayDate(c.published_at, lang)}</dd>
              </div>
            </dl>
            <RowActions
              c={c}
              S={S}
              activeTopicKey={s.active_topic_key}
              onReview={onReview}
              onTopicReview={onTopicReview}
            />
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <Table>
        <caption>{S.commentsCaption}</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{S.colAuthor}</TableHeaderCell>
            <TableHeaderCell>{S.colComment}</TableHeaderCell>
            <TableHeaderCell>{S.colSentiment}</TableHeaderCell>
            <TableHeaderCell>{S.colDate}</TableHeaderCell>
            <TableHeaderCell>{S.colCorrection}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {s.comments.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="db-comment-author-cell">
                  {c.author_profile_image_url && (
                    <img
                      src={c.author_profile_image_url}
                      alt=""
                      className="db-comment-avatar"
                      loading="lazy"
                    />
                  )}
                  <div className="db-comment-author-info-table">
                    {c.author_channel_url ? (
                      <a
                        href={c.author_channel_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="db-comment-author-link"
                      >
                        <bdi>{c.author_name ?? S.purgedAuthor}</bdi>
                      </a>
                    ) : (
                      <bdi>{c.author_name ?? S.purgedAuthor}</bdi>
                    )}
                    {c.is_reply && <small>{S.replyTag}</small>}
                    {c.reply_count != null && c.reply_count > 0 && (
                      <small className="db-comment-replies-badge">
                        ({S.countReplies(n(c.reply_count))})
                      </small>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>{commentText(c, S)}</TableCell>
              <TableCell>
                <SentimentChip
                  c={c}
                  labels={labels}
                  lang={lang}
                  noLabelText={S.unanalysedOrOld}
                />
                {c.reviewed && <small>{S.humanReview}</small>}
                {s.active_topic_key && (
                  <TopicChip c={c} S={S} topicName={topicName} />
                )}
              </TableCell>
              <TableCell>{displayDate(c.published_at, lang)}</TableCell>
              <TableCell>
                <RowActions
                  c={c}
                  S={S}
                  activeTopicKey={s.active_topic_key}
                  onReview={onReview}
                  onTopicReview={onTopicReview}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
