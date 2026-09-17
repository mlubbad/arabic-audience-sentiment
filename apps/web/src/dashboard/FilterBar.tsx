import { useState, type FormEvent, type ReactNode } from "react";
import { UNCLASSIFIED, type Label } from "@sentiment/contracts";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { SelectItem } from "../ui/Select";
import { videoLabel } from "../i18n";
import type { Locale } from "../locale";
import type { Strings } from "../strings";
import { Labelled } from "./Labelled";
import { extraCount, type FilterValues } from "./filters";
import { useMediaQuery } from "./useMediaQuery";
import "./filter-bar.css";

/** Radix `Select` cannot hold an empty-string value — `""` (this product's
 *  "no filter chosen") is mapped to this sentinel at the edge and back. */
const ALL = "__all";

export type FilterBarProps = {
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  onApply: () => void;
  onReset: () => void;
  onLimitChange: (n: number) => void;
  formError: string;
  videoOptions: { id: string; title: string | null }[];
  /** `null` when no topic model has run for this workspace — the control is
   *  not offered at all, rather than offered with nothing to select. */
  topics:
    | { key: string; name_ar: string; name_en: string; retired: boolean }[]
    | null;
  commentTypes: string[];
  S: Strings;
  lang: Locale;
  labels: Record<Label, string>;
  /** How many chips `ActiveFilters` would render right now — shown on the
   *  compact trigger so a phone reader sees the count without opening the
   *  sheet. Computed by the caller (`chipsFor(values, …).length`) rather
   *  than here, so this component stays a pure view over `values`. */
  appliedCount: number;
  /** The applied-filter chips (`ActiveFilters`), rendered as the last row
   *  inside the pinned pane. A narrowed report read as a whole one is a
   *  wrong one, and a reader who has scrolled learns what the page is
   *  narrowed to only if that row travels with the bar. */
  chips?: ReactNode;
};

export function FilterBar({
  values,
  onChange,
  onApply,
  onReset,
  onLimitChange,
  formError,
  videoOptions,
  topics,
  commentTypes,
  S,
  lang,
  labels,
  appliedCount,
  chips,
}: FilterBarProps) {
  const compact = useMediaQuery("(max-width: 900px)");
  const [sheet, setSheet] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    onApply();
  }
  function applyFromSheet() {
    onApply();
    setSheet(false);
  }

  const searchField = (
    <div className="db-field db-field--search">
      <label htmlFor="f-query" className="ui-sr-only">
        {S.searchLabel}
      </label>
      <Input
        id="f-query"
        value={values.query}
        placeholder={S.searchLabel}
        maxLength={500}
        onChange={(e) => onChange({ query: e.target.value })}
      />
    </div>
  );

  const videoSelect = (
    <Labelled
      id="f-video"
      label={S.videoLabelText}
      value={values.video || ALL}
      onValueChange={(v) => onChange({ video: v === ALL ? "" : v })}
    >
      <SelectItem value={ALL}>{S.allVideos}</SelectItem>
      {videoOptions.map((v) => (
        <SelectItem key={v.id} value={v.id}>
          {videoLabel(v.id, v.title, S)}
        </SelectItem>
      ))}
    </Labelled>
  );

  const sentimentSelect = (
    <Labelled
      id="f-sentiment"
      label={S.sentimentLabel}
      value={values.sentiment || ALL}
      onValueChange={(v) => onChange({ sentiment: v === ALL ? "" : v })}
    >
      <SelectItem value={ALL}>{S.allSentiments}</SelectItem>
      {(Object.entries(labels) as [Label, string][]).map(([key, text]) => (
        <SelectItem key={key} value={key}>
          {text}
        </SelectItem>
      ))}
    </Labelled>
  );

  // Offered only once a topic model has run — see the `topics` prop comment.
  const topicSelect =
    topics === null ? null : (
      <Labelled
        id="f-topic"
        label={S.topicFilterLabel}
        value={values.topic || ALL}
        onValueChange={(v) => onChange({ topic: v === ALL ? "" : v })}
      >
        <SelectItem value={ALL}>{S.topicAll}</SelectItem>
        {topics
          .filter((t) => !t.retired)
          .map((t) => (
            <SelectItem key={t.key} value={t.key}>
              {lang === "ar" ? t.name_ar : t.name_en}
            </SelectItem>
          ))}
        <SelectItem value={UNCLASSIFIED}>
          {S.topicUnclassifiedOption}
        </SelectItem>
      </Labelled>
    );

  const videoKindSelect = (
    <Labelled
      id="f-video-kind"
      label={S.videoKindLabel}
      value={values.videoKind || ALL}
      onValueChange={(v) => onChange({ videoKind: v === ALL ? "" : v })}
    >
      <SelectItem value={ALL}>{S.allKinds}</SelectItem>
      <SelectItem value="video">{S.kindVideo}</SelectItem>
      <SelectItem value="short">{S.kindShort}</SelectItem>
      <SelectItem value="stream">{S.kindStream}</SelectItem>
    </Labelled>
  );

  const participationSelect = (
    <Labelled
      id="f-participation"
      label={S.participationLabel}
      value={values.replies}
      onValueChange={(v) =>
        onChange({ replies: v as "all" | "comments" | "replies" })
      }
    >
      <SelectItem value="all">{S.commentsAndReplies}</SelectItem>
      <SelectItem value="comments">{S.originalOnly}</SelectItem>
      <SelectItem value="replies">{S.repliesOnly}</SelectItem>
    </Labelled>
  );

  // Offered only when the current read actually has comment types to filter
  // by — see Dashboard.tsx's original comment on `comment_types`.
  const commentTypeSelect =
    commentTypes.length === 0 ? null : (
      <Labelled
        id="f-comment-type"
        label={S.commentTypeLabel}
        value={values.commentType || ALL}
        onValueChange={(v) => onChange({ commentType: v === ALL ? "" : v })}
      >
        <SelectItem value={ALL}>{S.allKinds}</SelectItem>
        {commentTypes.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </Labelled>
    );

  const reviewStatusSelect = (
    <Labelled
      id="f-review-status"
      label={S.reviewStatusLabel}
      value={values.reviewStatus}
      onValueChange={(v) =>
        onChange({ reviewStatus: v as "all" | "reviewed" | "unreviewed" })
      }
    >
      <SelectItem value="all">{S.all}</SelectItem>
      <SelectItem value="reviewed">{S.reviewedByHuman}</SelectItem>
      <SelectItem value="unreviewed">{S.unreviewed}</SelectItem>
    </Labelled>
  );

  const dateModeSelect = (
    <Labelled
      id="f-date-mode"
      label={S.dateLabel}
      value={values.dateMode}
      onValueChange={(v) =>
        onChange({ dateMode: v as "all" | "known" | "unknown" })
      }
    >
      <SelectItem value="all">{S.allDates}</SelectItem>
      <SelectItem value="known">{S.knownDates}</SelectItem>
      <SelectItem value="unknown">{S.unknownDates}</SelectItem>
    </Labelled>
  );

  const fromInput = (
    <label htmlFor="f-from">
      {S.fromDate}
      <Input
        id="f-from"
        type="date"
        value={values.from}
        disabled={values.dateMode === "unknown"}
        onChange={(e) => onChange({ from: e.target.value })}
      />
    </label>
  );

  const toInput = (
    <label htmlFor="f-to">
      {S.toDate}
      <Input
        id="f-to"
        type="date"
        value={values.to}
        disabled={values.dateMode === "unknown"}
        onChange={(e) => onChange({ to: e.target.value })}
      />
    </label>
  );

  const perPageSelect = (
    <Labelled
      id="f-per-page"
      label={S.perPageLabel}
      value={String(values.limit)}
      onValueChange={(v) => onLimitChange(Number(v))}
    >
      {[5, 10, 25, 50].map((size) => (
        <SelectItem key={size} value={String(size)}>
          {size}
        </SelectItem>
      ))}
    </Labelled>
  );

  // Built once and placed in whichever container the layout below needs —
  // a popover's stack on desktop, the sheet's stack on a phone. Never two
  // separate option lists to keep in sync.
  const periodControls = (
    <>
      {dateModeSelect}
      {fromInput}
      {toInput}
    </>
  );
  const moreControls = (
    <>
      {topicSelect}
      {videoKindSelect}
      {participationSelect}
      {commentTypeSelect}
      {reviewStatusSelect}
      {perPageSelect}
    </>
  );

  const periodLabel =
    values.from || values.to
      ? `${values.from || "…"} → ${values.to || "…"}`
      : S.dateLabel;

  return (
    <form
      id="report-filters"
      aria-label={S.filtersLabel}
      className="db-filterbar"
      onSubmit={submit}
    >
      {compact ? (
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSheet(true)}
          >
            {S.filtersButton(appliedCount)}
          </Button>
          <Dialog open={sheet} onOpenChange={setSheet}>
            <DialogContent
              variant="sheet"
              closeLabel={S.cancel}
              aria-describedby={undefined}
            >
              <DialogTitle>{S.filtersLabel}</DialogTitle>
              <div className="db-sheet-stack">
                {searchField}
                {videoSelect}
                {sentimentSelect}
                {periodControls}
                {moreControls}
                <div className="db-filterbar-actions">
                  <Button type="button" onClick={applyFromSheet}>
                    {S.applyFilters}
                  </Button>
                  <Button variant="ghost" type="button" onClick={onReset}>
                    {S.resetFilters}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          {searchField}
          {videoSelect}
          {sentimentSelect}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                aria-label={S.dateLabel}
              >
                {periodLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="db-popover-stack">{periodControls}</div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="secondary">
                {S.moreFilters(extraCount(values))}
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="db-popover-stack">{moreControls}</div>
            </PopoverContent>
          </Popover>
          <div className="db-filterbar-actions">
            <Button type="submit">{S.applyFilters}</Button>
            <Button variant="ghost" type="button" onClick={onReset}>
              {S.resetFilters}
            </Button>
          </div>
        </>
      )}
      {formError && (
        <p role="alert" className="db-filterbar-error">
          {formError}
        </p>
      )}
      {chips && <div className="db-filterbar-chips">{chips}</div>}
    </form>
  );
}
