/**
 * Video comparison — `ui/Table` on wide screens, stacked `Card`+`dl` at
 * phone width, same data either way.
 *
 * Each row's video name is a button rather than plain text: clicking it
 * applies the video filter, through the same `onPick` path `Videos.tsx`
 * already uses (`Dashboard.tsx` wires both to one `pickVideo` toggle) —
 * a comparison a reader wants to drill into is a filter change like any
 * other, not a second selection mechanism.
 *
 * Within this column's cell, the bar and the `<ul className="share">` list
 * beside it share one denominator: `analysed`. This column reports the
 * distribution *among analysed rows* — "of what was analysed, how much was
 * each label" — so a bar drawn against `total` here would show a narrower
 * slice than the percentages printed right next to it for the same video,
 * which is the one thing a bar-plus-figures pairing must never do. (Fix
 * round 1: an earlier version of this file drew the bar against `total`,
 * copying `Videos.tsx`'s rule into a cell that prints against a different
 * denominator — the two disagreed for any partly analysed video.)
 * `Videos.tsx` keeps `total` for its own bar: it prints no percentages
 * beside it, and the muted remainder of that bar *is* its statement about
 * what is unanalysed, which this column already makes in words via
 * `S.colAnalysed`'s own value.
 */
import type { Label } from "@sentiment/contracts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { videoLabel } from "../i18n";
import { splitSegments } from "./splitBar";
import { useMediaQuery } from "./useMediaQuery";
import "./compare.css";

type ComparedVideo = Snapshot["comparison"][number];

function Distribution({
  v,
  labels,
  S,
}: {
  v: ComparedVideo;
  labels: Record<Label, string>;
  S: Strings;
}) {
  if (v.analysed === 0) return <small>{S.noAnalysedInFilters}</small>;
  // Denominator: `analysed`, not `total` — this cell's bar and its printed
  // shares must agree, and the shares beside it are already a share of what
  // was analysed.
  const segments = splitSegments(v.sentiments, v.analysed);
  // Spoken form matches the printed form exactly: same labels, same counts,
  // same rounded percentage — built from `seg.pct`, which is already
  // `count / analysed * 100`, not recomputed against a different base.
  const shareLabel = segments
    .map((seg) => S.shareItem(labels[seg.key], seg.count, Math.round(seg.pct)))
    .join("، ");
  return (
    <div className="db-compare-distribution">
      <span className="ui-split" role="img" aria-label={shareLabel}>
        {segments.map((seg) => (
          <i
            key={seg.key}
            className={seg.key}
            style={{ width: `${seg.pct}%` }}
          />
        ))}
      </span>
      <ul className="share">
        {(Object.entries(v.sentiments) as [Label, number][]).map(
          ([k, count]) => (
            <li key={k}>
              {S.shareItem(
                labels[k],
                count,
                Math.round((count / v.analysed) * 100),
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function Compare({
  s,
  S,
  labels,
  onPick,
}: {
  s: Snapshot;
  S: Strings;
  labels: Record<Label, string>;
  onPick: (id: string) => void;
}) {
  const stacked = useMediaQuery("(max-width: 760px)");
  return (
    <section
      className="db-section"
      id="rp-compare"
      aria-labelledby="comparison-heading"
    >
      <header>
        <h2 id="comparison-heading">{S.compareTitle}</h2>
      </header>
      <p className="db-muted" data-testid="comparison-scope">
        {S.compareScope}
      </p>
      {s.comparison_truncated && (
        <p className="db-muted">{S.compareTruncated}</p>
      )}
      {stacked ? (
        <div className="db-compare-cards">
          {s.comparison.map((v) => (
            <Card key={v.id} data-testid={`compare-${v.id}`}>
              <h3 className="db-card-title">
                <Button
                  variant="ghost"
                  size="sm"
                  className="db-compare-pick"
                  onClick={() => onPick(v.id)}
                >
                  {videoLabel(v.id, v.title)}
                </Button>
              </h3>
              <dl className="db-compare-dl">
                <div>
                  <dt>{S.colComments}</dt>
                  <dd>{v.total}</dd>
                </div>
                <div>
                  <dt>{S.colReplies}</dt>
                  <dd>{v.replies}</dd>
                </div>
                <div>
                  <dt>{S.colAnalysed}</dt>
                  <dd>{v.analysed}</dd>
                </div>
                <div>
                  <dt>{S.colDistribution}</dt>
                  <dd>
                    <Distribution v={v} labels={labels} S={S} />
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <Table>
            <caption>{S.compareCaption}</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.colVideo}</TableHeaderCell>
                <TableHeaderCell>{S.colComments}</TableHeaderCell>
                <TableHeaderCell>{S.colReplies}</TableHeaderCell>
                <TableHeaderCell>{S.colAnalysed}</TableHeaderCell>
                <TableHeaderCell>{S.colDistribution}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.comparison.map((v) => (
                <TableRow key={v.id} data-testid={`compare-${v.id}`}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="db-compare-pick"
                      onClick={() => onPick(v.id)}
                    >
                      {videoLabel(v.id, v.title)}
                    </Button>
                  </TableCell>
                  <TableCell>{v.total}</TableCell>
                  <TableCell>{v.replies}</TableCell>
                  <TableCell>{v.analysed}</TableCell>
                  <TableCell>
                    <Distribution v={v} labels={labels} S={S} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
