/**
 * The comments section — three `ui/Tabs` triggers choosing which twelve
 * cards are shown, the export action, the table (`CommentsTable`, which
 * switches to stacked cards on its own under 760px), and the pager.
 *
 * The tabs pick which twelve of `cards` are on screen; they do not gate a
 * `TabsContent` panel, because `cards` is already the one filtered-and-
 * sliced array `Dashboard.tsx`'s `useMemo` produced for whichever tab is
 * current — there is nothing tab-specific left to branch on here. Same
 * pattern `ProductWindow` uses for its filter row: `aria-controls`
 * explicitly cleared on each trigger so Radix does not point it at a
 * panel id that exists nowhere.
 *
 * `children` is the review form — still built and owned by `Dashboard.tsx`
 * (Task 10 will turn it into a `ReviewDialog`) — rendered here, between the
 * table and the pager, exactly where it always stood.
 *
 * The brief's signature also lists a trailing `mode`; nothing this
 * component renders reads it (the one place that did, the review form's
 * fixture-scope note, stays in `Dashboard.tsx` as part of `children`), so
 * it is dropped here rather than carried as an unused prop — the same call
 * Task 7 made for `Voice`'s unused `lang` and Task 8 made for `People`'s
 * unused `s`.
 */
import type { ReactNode } from "react";
import type { Label, LabelledComment } from "@sentiment/contracts";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";
import { Card } from "../ui/Card";
import { Badge, type BadgeProps } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import type { Locale } from "../locale";
import { commentText, displayDate } from "../i18n";
import { n } from "./format";
import { CommentsTable, confidencePct } from "./CommentsTable";
import "./comments.css";

type CardTab = "liked" | "recent" | "critical";

/** The sentiment scale's own tone, never `neutral`'s badge default — same
 *  map `Hero.tsx` and `CommentsTable.tsx` use. */
const SENTIMENT_TONE: Record<Label, BadgeProps["tone"]> = {
  positive: "positive",
  negative: "negative",
  mixed: "sentiment-mixed",
  neutral: "sentiment-neutral",
};

export function Comments({
  s,
  S,
  lang,
  labels,
  cards,
  cardTab,
  onCardTab,
  cursors,
  onGo,
  isFetching,
  cursorNotice,
  exporting,
  onExport,
  onReview,
  onTopicReview,
  topicName,
  children,
}: {
  s: Snapshot;
  S: Strings;
  lang: Locale;
  labels: Record<Label, string>;
  cards: LabelledComment[];
  cardTab: CardTab;
  onCardTab: (tab: CardTab) => void;
  cursors: string[];
  onGo: (cursors: string[]) => void;
  isFetching: boolean;
  cursorNotice: boolean;
  exporting: { isPending: boolean; isError: boolean };
  onExport: () => void;
  onReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
  onTopicReview: (c: LabelledComment, trigger: HTMLButtonElement) => void;
  topicName: (key: string) => string;
  children?: ReactNode;
}) {
  return (
    <section
      className="db-section"
      id="rp-comments"
      data-testid="comments-table"
    >
      <header>
        {/* `tabIndex={-1}` + the id: `ReviewDialog.tsx`'s `onCloseAutoFocus`
            fallback target, for when the row that opened it is gone (a
            reviewed row can drop out of the "غير المراجَع" filter on save). */}
        <h2 id="rp-comments-title" tabIndex={-1}>
          {S.secComments}
        </h2>
        <p className="db-lead">{S.commentsLead}</p>
      </header>
      <Tabs value={cardTab} onValueChange={(v) => onCardTab(v as CardTab)}>
        <TabsList className="db-card-tabs" aria-label={S.secComments}>
          {/* No `TabsContent` panels: the tabs pick which slice of `cards`
              Dashboard.tsx already computed, not a panel-per-tab. */}
          <TabsTrigger value="liked" aria-controls={undefined}>
            {S.tabMostLiked}
          </TabsTrigger>
          <TabsTrigger value="recent" aria-controls={undefined}>
            {S.tabNewest}
          </TabsTrigger>
          <TabsTrigger value="critical" aria-controls={undefined}>
            {S.tabCritical}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ul className="db-comment-cards" data-testid="rp-cards">
        {cards.map((c) => {
          const score = confidencePct(c);
          return (
            <li key={c.id}>
              <Card className="db-comment">
                <div className="db-comment-head">
                  <span className="db-comment-who">
                    {/* A purged author is named as purged, not left blank
                        and not replaced with a plausible name. `<bdi>` keeps
                        a Latin handle reading left-to-right (`@abu_faisal`,
                        not `abu_faisal@`) inside the surrounding RTL text. */}
                    <bdi>{c.author_name ?? S.purgedAuthor}</bdi>
                  </span>
                  <Badge tone={c.label ? SENTIMENT_TONE[c.label] : "neutral"}>
                    {c.label ? labels[c.label] : S.noLabel}
                    {score !== null && (
                      <span className="db-chip-score">
                        {score}
                        {lang === "ar" ? "٪" : "%"}
                      </span>
                    )}
                  </Badge>
                </div>
                <p className="db-comment-text">{commentText(c, S)}</p>
                <div className="db-comment-foot">
                  <span>{displayDate(c.published_at, lang)}</span>
                  <span>
                    {/* Unknown likes are said to be unknown. Rendering a
                        zero here would be a number we invented. */}
                    {c.likes_value === null
                      ? S.likesUnknown
                      : S.countLikes(n(c.likes_value))}
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {cursorNotice && (
        <p role="status" data-testid="cursor-notice" className="db-muted">
          {S.cursorReset}
        </p>
      )}
      {/* Above the table, not under it.
          It exports the whole filtered set, not the page on screen — so it
          belongs with the thing it describes, before a reader has scrolled
          twenty-five rows past the point where knowing that would have
          helped. A control that only appears once you have finished
          reading is one you find after you needed it. */}
      <div className="db-export">
        <Button
          variant="secondary"
          onClick={onExport}
          disabled={exporting.isPending}
        >
          {S.exportCsv}
        </Button>
        <p className="db-muted">{S.exportNote(s.total)}</p>
        {exporting.isError && (
          <p role="alert" data-testid="export-error">
            {S.exportFailed}
          </p>
        )}
      </div>
      <CommentsTable
        s={s}
        S={S}
        lang={lang}
        labels={labels}
        topicName={topicName}
        onReview={onReview}
        onTopicReview={onTopicReview}
      />
      {children}
      <nav className="db-pager" aria-label={S.pagerLabel}>
        <Button
          variant="secondary"
          size="sm"
          disabled={cursors.length === 0 || isFetching}
          onClick={() => onGo(cursors.slice(0, -1))}
        >
          {S.previousPage}
        </Button>
        <p data-testid="page-state" aria-live="polite">
          {S.pageState(cursors.length + 1, s.comments.length, s.total)}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!s.next_cursor || isFetching}
          onClick={() => s.next_cursor && onGo([...cursors, s.next_cursor])}
        >
          {S.nextPage}
        </Button>
      </nav>
    </section>
  );
}
