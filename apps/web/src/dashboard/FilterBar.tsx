import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { UNCLASSIFIED, type Label } from "@sentiment/contracts";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { SelectItem } from "../ui/Select";
import { videoLabel } from "../i18n";
import type { Locale } from "../locale";
import type { Strings } from "../strings";
import { Labelled } from "../ui/Labelled";
import { extraCount, type FilterValues } from "./filters";
import { useMediaQuery } from "../ui/useMediaQuery";
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
   *  sheet. Computed by the caller from the *applied* filters
   *  (`chipsFor(appliedValues(filters, …), …).length`), not from `values`,
   *  which is the draft: a count that moved on every pick would claim a
   *  narrowing the figures do not have yet. */
  appliedCount: number;
  /** The applied-filter chips (`ActiveFilters`) — built from the applied
   *  filters, never from `values` — rendered as the last row
   *  inside the pinned pane. A narrowed report read as a whole one is a
   *  wrong one, and a reader who has scrolled learns what the page is
   *  narrowed to only if that row travels with the bar. */
  chips?: ReactNode;
  /** The pinned bar's measured height in px, reported whenever it changes
   *  (a wrapped row, a chips row appearing, a resize). `Dashboard` hands it
   *  to `useActiveSection`, whose observer must know where the bar ends;
   *  the CSS side reads the same number from `--db-pinned-h`. */
  onPinnedHeight?: (px: number) => void;
};

/** The custom property `.db-section`'s `scroll-margin-top` reads, written
 *  on the root so a section anchor lands under the bar rather than behind
 *  it whatever the bar's height is this minute. */
export const PINNED_HEIGHT_VAR = "--db-pinned-h";

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
  onPinnedHeight,
}: FilterBarProps) {
  const compact = useMediaQuery("(max-width: 900px)");
  const [sheet, setSheet] = useState(false);
  const barRef = useRef<HTMLFormElement>(null);

  // The bar is the page's one pinned element and its height is not a
  // constant: one row or two, a chips row or none, a phone's single button.
  // Measured rather than assumed, and published two ways — as a custom
  // property for `scroll-margin-top`, and as a number for the section
  // observer — so neither can drift from what is actually on screen.
  // Guarded for the prerender (no `window`) and for jsdom (no observer).
  useEffect(() => {
    if (!onPinnedHeight) return;
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      root.style.setProperty(PINNED_HEIGHT_VAR, `${Math.round(h)}px`);
      onPinnedHeight(h);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(PINNED_HEIGHT_VAR);
    };
  }, [onPinnedHeight]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onApply();
  }
  function applyFromSheet() {
    onApply();
    setSheet(false);
  }

  const searchField = (
    <div className="ui-field ui-field--search">
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

  // In the pinned bar the two always-visible selects go without a visible
  // label: their triggers already read «كل الفيديوهات» / «كل المشاعر», and a
  // label row above them is the difference between a bar of one row and one
  // of two. The sheet, which is not pinned, keeps the labels.
  const videoSelect = (
    <Labelled
      id="f-video"
      label={S.videoLabelText}
      labelHidden={!compact}
      value={values.video || ALL}
      onValueChange={(v) => onChange({ video: v === ALL ? "" : v })}
    >
      <SelectItem value={ALL}>{S.allVideos}</SelectItem>
      {videoOptions.map((v) => (
        <SelectItem key={v.id} value={v.id}>
          {videoLabel(v.id, v.title)}
        </SelectItem>
      ))}
    </Labelled>
  );

  const sentimentSelect = (
    <Labelled
      id="f-sentiment"
      label={S.sentimentLabel}
      labelHidden={!compact}
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
      <SelectItem value="channel_post">{S.kindPost}</SelectItem>
    </Labelled>
  );

  const platformSelect = (
    <Labelled
      id="f-platform"
      label={S.platformFilterLabel}
      value={values.platform || ALL}
      onValueChange={(v) => onChange({ platform: v === ALL ? "" : v })}
    >
      <SelectItem value={ALL}>{S.allPlatforms}</SelectItem>
      <SelectItem value="youtube">{S.platformYouTube}</SelectItem>
      <SelectItem value="telegram">{S.platformTelegram}</SelectItem>
      <SelectItem value="x">{S.platformX}</SelectItem>
      <SelectItem value="tiktok">{S.platformTikTok}</SelectItem>
      <SelectItem value="facebook">{S.platformFacebook}</SelectItem>
      <SelectItem value="instagram">{S.platformInstagram}</SelectItem>
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
      {platformSelect}
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
      data-tour="filters"
      onSubmit={submit}
      ref={barRef}
    >
      {compact ? (
        <>
          {/* The button is the dialog's own trigger, not a button that
              happens to open it: Radix then knows where focus came from and
              puts it back there on close, which a manual `setSheet(true)`
              never told it. `open`/`onOpenChange` stay controlled so the
              sheet's «تطبيق» can close it. */}
          <Dialog open={sheet} onOpenChange={setSheet}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary" size="sm">
                {S.filtersButton(appliedCount)}
              </Button>
            </DialogTrigger>
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
          {/* The two popover triggers and the actions wrap as one: a popover
              opens above or below its trigger's row, never over it, so
              «تطبيق» must share that row.
              When the bar wrapped between them (1280px, 2026-10-09) the
              «المزيد» popover opened over «تطبيق» and «إعادة ضبط», and a press
              there landed on the popover's «الموضوع» label instead. */}
          <div className="db-filterbar-tail">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
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
                <Button type="button" variant="secondary" size="sm">
                  {S.moreFilters(extraCount(values))}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="db-popover-stack">{moreControls}</div>
              </PopoverContent>
            </Popover>
            <div className="db-filterbar-actions">
              <Button type="submit" size="sm">
                {S.applyFilters}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={onReset}>
                {S.resetFilters}
              </Button>
            </div>
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
