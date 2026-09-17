import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Chip } from "./filters";

/**
 * What the numbers below are conditional on, carried by the one bar that
 * stays on screen. A reader who scrolled past the filter bar an hour ago
 * has no other way to know the report is narrowed — and a narrowed report
 * read as a whole one is not a smaller answer, it is a wrong one.
 *
 * Each chip is the applied state itself, not a draft of it: clicking a
 * chip's remove button clears that one filter and re-applies immediately,
 * unlike the bar's own apply button.
 */
export function ActiveFilters({
  chips,
  scope,
  onClear,
  onReset,
  S,
}: {
  chips: Chip[];
  scope: string;
  onClear: (key: Chip["key"]) => void;
  onReset: () => void;
  S: Strings;
}) {
  if (chips.length === 0) {
    return <span className="db-scope">{scope}</span>;
  }
  return (
    <p className="db-scope" data-testid="active-filters">
      <span>{S.filteredLabel}</span>
      {chips.map(({ key, label }) => (
        <Badge key={key} tone="neutral" className="db-chip">
          {label}
          <Button
            variant="ghost"
            size="sm"
            aria-label={S.removeFilter(label)}
            onClick={() => onClear(key)}
          >
            ×
          </Button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={onReset}>
        {S.showAll}
      </Button>
    </p>
  );
}
