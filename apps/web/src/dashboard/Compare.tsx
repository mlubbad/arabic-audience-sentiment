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
 * The split bar's segment widths are the share of each video's TOTAL
 * comments (`splitBar.ts`, lifted from `Videos.tsx`), never of `analysed` —
 * but the exact per-class counts and percentages in the `<ul className="share">`
 * list beside it stay computed against `analysed`, unchanged: that list
 * answers "of what was analysed, how much was each label", which is a
 * different question from the bar's "how much of the video is this slice",
 * and only the second one was ever wrong.
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
  const segments = splitSegments(v.sentiments, v.total);
  return (
    <div className="db-compare-distribution">
      {/* Decorative: the list right below carries the same information as
          text, so the bar is not announced a second time. */}
      <span className="ui-split" aria-hidden="true">
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
                  {videoLabel(v.id, v.title, S)}
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
                      {videoLabel(v.id, v.title, S)}
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
