/**
 * Per-video cards, on `ui/Card`, with the shared split bar.
 *
 * The card itself stays the clickable toggle it always was — a filter
 * change like any other, going through the same `onPick` path rather than a
 * second one here — because an existing browser test drives it exactly that
 * way: it finds the card by `data-testid`, clicks it, and reads
 * `aria-pressed` back off the *same* element twice (selected, then cleared
 * by a second click). That fixes where `data-testid`, `aria-pressed` and the
 * click handler have to live: together, on this element, not split across a
 * decorative wrapper and a nested action button. `video` is the currently
 * applied filter value, read here only to answer "is this the one" — the
 * toggle decision itself (`next = video === id ? "" : id`) stays in
 * `Dashboard.tsx`, which is the only place that also owns `setVideo`.
 *
 * The split bar's `aria-label` is built from the same `legendMeasured` /
 * `legendUnmeasured` sentences the sentiment legend already reads out loud,
 * one per non-empty class, with the same denominator the legend uses
 * (`analysed`) — there was no prior spoken description of a per-video
 * split to preserve (the bar was `aria-hidden`, its numbers carried only by
 * the visible counts beside it), so this is a new, accurate one built
 * entirely from strings that already exist.
 */
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import type { PageSlice } from "../videoPaging";
import { videoLabel } from "../i18n";
import { n } from "./format";
import { splitAriaLabel, splitSegments } from "./splitBar";
import "./videos.css";

export function Videos({
  s,
  S,
  slice,
  video,
  onTurn,
  onPick,
}: {
  s: Snapshot;
  S: Strings;
  slice: PageSlice<Snapshot["videos"][number]>;
  /** The currently applied video filter, `""` when none — used only to mark
   *  the matching card pressed. */
  video: string;
  onTurn: (page: number) => void;
  onPick: (id: string) => void;
}) {
  const labels = S.labels;
  return (
    <section className="db-section" id="rp-videos">
      <header>
        <h2>{S.secVideosTitle}</h2>
        <p className="db-lead">{S.videosLead}</p>
      </header>
      <div className="db-videos">
        {slice.items.map((v) => {
          // Denominator: `total`, not `analysed` — this card prints no
          // percentages beside the bar, so its muted remainder is itself
          // the "unanalysed" statement (contrast `Compare.tsx`'s cell,
          // which prints shares and so must share their `analysed` base).
          // Only the segments that hold something, each sized to its share
          // of `total` — a video with no mixed comments does not draw a
          // sliver of one, and one only half analysed draws half a bar.
          const segments = splitSegments(v.sentiments, v.total);
          // Spoken over `analysed`, not `total`: `legendMeasured` always
          // says a percentage, and every percentage printed on this page —
          // the sentiment legend, the comparison table — is a share of what
          // was analysed. The drawn widths above stay a share of `total`
          // (the muted remainder is the unanalysed part); the spoken shares
          // are the ones a reader would compare with the rest of the page.
          // No segments is not "no bar": the container's own muted
          // background is the true state for a video with nothing analysed
          // yet, and the same string the comparison table already uses for
          // that case names it.
          const splitLabel = splitAriaLabel(
            splitSegments(v.sentiments, v.analysed),
            s.measurable,
            labels,
            S,
          );
          return (
            <Card
              key={v.id}
              className="db-video"
              data-testid={`rp-video-${v.id}`}
              role="button"
              tabIndex={0}
              aria-pressed={video === v.id}
              onClick={() => onPick(v.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(v.id);
                }
              }}
            >
              <h3 className="db-card-title">{videoLabel(v.id, v.title)}</h3>
              <div className="db-row-actions">
                {v.id === s.videos[0]?.id && s.videos.length > 1 && (
                  <Badge tone="warning">{S.videoTagTopVolume}</Badge>
                )}
                {v.analysed >= 5 &&
                  v.sentiments.negative / v.analysed >= 0.3 && (
                    <Badge tone="negative">{S.videoTagHighNegative}</Badge>
                  )}
                {v.analysed >= 5 &&
                  v.sentiments.positive / v.analysed >= 0.7 && (
                    <Badge tone="positive">{S.videoTagTopPositive}</Badge>
                  )}
                <Badge numeric>{S.countComments(n(v.total))}</Badge>
                <Badge numeric>{S.countReplies(n(v.replies))}</Badge>
                <Badge numeric>{S.countAnalysed(n(v.analysed))}</Badge>
              </div>
              <div className="ui-split" role="img" aria-label={splitLabel}>
                {segments.map((seg) => (
                  <i
                    key={seg.key}
                    className={seg.key}
                    style={{ width: `${seg.pct}%` }}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {/* Only when there is a second page. A pager reading "1 of 1" under
          five cards is furniture; under 194 it is the way in. */}
      {slice.pages > 1 && (
        <nav className="db-pager" aria-label={S.videosPagerLabel}>
          <Button
            variant="secondary"
            size="sm"
            disabled={slice.page === 0}
            onClick={() => onTurn(slice.page - 1)}
          >
            {S.previousPage}
          </Button>
          <p data-testid="video-page-state" aria-live="polite">
            {S.videosPageState(
              slice.page + 1,
              slice.pages,
              slice.from,
              slice.to,
              s.videos.length,
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={slice.page >= slice.pages - 1}
            onClick={() => onTurn(slice.page + 1)}
          >
            {S.nextPage}
          </Button>
        </nav>
      )}
    </section>
  );
}
