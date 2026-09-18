/**
 * What this screen is showing, and where it came from.
 *
 * `source` is `describeSource()`'s output — every sentence here is derived
 * from the same values that decide the dashboard's behaviour, never written
 * by hand, so the label and the truth cannot drift apart (see
 * `dataSource.ts`'s own docstring). `.db-provenance` is pages.css's: the
 * operations page wears the same strip for its demo note.
 */
import { Badge } from "../ui/Badge";
import type { SourceDescription } from "../dataSource";

export function Provenance({ source }: { source: SourceDescription }) {
  return (
    <div
      role="note"
      className="db-provenance"
      data-testid="source"
      data-mode={source.mode}
      data-tone={source.tone}
    >
      <Badge tone={source.tone === "warning" ? "warning" : "neutral"}>
        <strong>{source.badge}</strong>
      </Badge>
      <p data-testid="source-scope">{source.scope}</p>
      <p data-testid="source-coverage">{source.coverage}</p>
      <p data-testid="data-mode">{source.persistence}</p>
      {source.freshness && (
        <p data-testid="source-freshness">{source.freshness}</p>
      )}
    </div>
  );
}
