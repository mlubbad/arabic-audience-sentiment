import type { Overlap } from "../api/audience";
import { n } from "../dashboard/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { Button } from "../ui/Button";
import type { Locale } from "../locale";
import type { Strings } from "../strings";

export function shareText(
  value: number | null,
  ci: { low: number | null; high: number | null } | null,
  lang: Locale,
) {
  if (value == null || !ci || ci.low == null || ci.high == null) return null;
  const suffix = lang === "ar" ? "٪" : "%";
  return `${n(Math.round(value * 100))} ${suffix} (${n(Math.round(ci.low * 100))}–${n(Math.round(ci.high * 100))} ${suffix})`;
}
export function OverlapTable({
  data,
  selected,
  onSelect,
  lang,
  S,
}: {
  data: Overlap;
  selected: string | null;
  onSelect: (id: string) => void;
  lang: Locale;
  S: Strings;
}) {
  return (
    <div className="audience-table-wrap">
      <Table className="audience-table">
        <TableHead>
          <TableRow>
            <TableHeaderCell>{S.audienceChannel}</TableHeaderCell>
            <TableHeaderCell>{S.audienceTheirSize}</TableHeaderCell>
            <TableHeaderCell>{S.audienceShareMine}</TableHeaderCell>
            <TableHeaderCell>{S.audienceShareTheirs}</TableHeaderCell>
            <TableHeaderCell>{S.audienceAffinity}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.others.map((row) => {
            const share = row.below_threshold
              ? null
              : shareText(row.share_of_mine, row.share_of_mine_ci, lang);
            return (
              <TableRow
                key={row.channel_id}
                className={
                  selected === row.channel_id ? "is-selected" : undefined
                }
              >
                <TableCell>
                  <Button
                    variant="link"
                    className="audience-row-button"
                    type="button"
                    onClick={() => onSelect(row.channel_id)}
                  >
                    {row.title || row.handle || row.channel_id}
                  </Button>
                  {row.share_of_mine != null && row.share_of_mine > 0.3 && (
                    <span className="audience-high">{S.audienceHigh}</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.below_threshold ? (
                    S.audienceInsufficient
                  ) : (
                    <>
                      {S.audienceOurCalculation}:{" "}
                      {row.audience_size == null ? "—" : n(row.audience_size)}
                    </>
                  )}
                </TableCell>
                <TableCell>
                  {row.below_threshold ? (
                    S.audienceInsufficient
                  ) : share ? (
                    <>
                      {S.audienceOurCalculation}: {share}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.below_threshold ? (
                    S.audienceInsufficient
                  ) : (
                    <>
                      {S.audienceOurCalculation}:{" "}
                      {row.share_of_theirs == null
                        ? "—"
                        : `${n(Math.round(row.share_of_theirs * 100))} ${lang === "ar" ? "٪" : "%"}`}
                    </>
                  )}
                </TableCell>
                <TableCell>
                  {row.below_threshold ? (
                    S.audienceInsufficient
                  ) : row.affinity == null ? (
                    "—"
                  ) : (
                    <>
                      <span>
                        {S.audienceOurCalculation}: {n(row.affinity)}
                      </span>
                      <span
                        className={`audience-affinity audience-affinity-${Math.min(10, Math.max(0, Math.round(row.affinity / 20)))}`}
                        aria-label={`${S.audienceAffinity}: ${n(row.affinity)}`}
                      >
                        <i />
                        <b />
                      </span>
                    </>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="audience-cards">
        {data.others.map((row) => (
          <Button
            variant="ghost"
            type="button"
            key={row.channel_id}
            className="audience-card"
            onClick={() => onSelect(row.channel_id)}
          >
            <strong>{row.title || row.handle || row.channel_id}</strong>
            <span>
              {row.below_threshold
                ? S.audienceInsufficient
                : `${S.audienceOurCalculation}: ${shareText(row.share_of_mine, row.share_of_mine_ci, lang) ?? "—"}`}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
