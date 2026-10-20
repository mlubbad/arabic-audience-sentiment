import type { OverlapOther } from "../api/audience";
import type { Strings } from "../strings";
import { n, pct } from "../dashboard/format";
import type { Locale } from "../locale";

export function Venn({
  mine,
  row,
  lang,
  S,
}: {
  mine: number | null;
  row: OverlapOther;
  lang: Locale;
  S: Strings;
}) {
  const shared = row.below_threshold ? null : row.shared;
  const ratio = row.share_of_mine;
  const maxSize = Math.max(mine ?? 0, row.audience_size ?? 0, 1);
  const radius = (size: number | null) =>
    30 + 28 * Math.sqrt((size ?? 0) / maxSize);
  const mineRadius = radius(mine);
  const otherRadius = radius(row.audience_size);
  const label = `${S.audienceOurCalculation} · ${S.audienceVenn}: ${mine == null ? "—" : n(mine)}, ${row.audience_size == null ? "—" : n(row.audience_size)}, ${shared == null ? S.audienceInsufficient : n(shared)}${ratio == null ? "" : `, ${pct(Math.round(ratio * 100), lang)}`}`;
  return (
    <section className="audience-panel">
      <h2>{S.audienceVenn}</h2>
      <svg viewBox="0 0 320 150" role="img" aria-label={label}>
        <circle cx="118" cy="75" r={mineRadius} />
        <circle cx="194" cy="75" r={otherRadius} />
        <text x="97" y="81">
          {mine == null ? "—" : n(mine)}
        </text>
        <text x="215" y="81">
          {row.audience_size == null ? "—" : n(row.audience_size)}
        </text>
        <text x="157" y="81">
          {shared == null ? S.audienceInsufficient : n(shared)}
        </text>
      </svg>
      <p>{S.audienceVennExplain}</p>
      <p>
        {S.audienceOurCalculation}:{" "}
        {shared == null
          ? S.audienceInsufficient
          : `${n(shared)} · ${pct(ratio == null ? null : Math.round(ratio * 100), lang)}`}
      </p>
    </section>
  );
}
