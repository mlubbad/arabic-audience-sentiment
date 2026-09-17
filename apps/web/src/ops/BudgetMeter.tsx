/**
 * One plan budget, as a bar and a sentence that always agree.
 *
 * A native `<progress>` used to carry this: Chrome paints it with the
 * browser's own accent, so a panel warning that a limit was near showed a
 * cheerful green bar, and a different colour in every browser. The fill
 * here is a plain `<i>`, coloured from the same `budgetState` the sentence
 * is built from (`ok`/`warning`/`critical`/`exhausted` — see
 * `packages/contracts`'s `budgetState`), so the two can never disagree and
 * no browser has an opinion on the colour.
 *
 * The bar still carries `role="progressbar"` with the numbers a screen
 * reader needs; `sentence` (into the `<small>` the e2e suite reads by
 * `data-state`) says the same thing in words.
 */
export function BudgetMeter({
  used,
  allowance,
  state,
  label,
  sentence,
  testId,
}: {
  used: number;
  allowance: number;
  /** `budgetState`'s own return type — kept structural here so this file
   *  does not need to import a function it never calls. */
  state: "ok" | "warning" | "critical" | "exhausted";
  /** The budget's name (e.g. «تحليل التعليقات»), read as the bar's
   *  accessible name. */
  label: string;
  /** The share and the state message, e.g. «74٪ — اقترب الاستهلاك من الحد». */
  sentence: string;
  testId: string;
}) {
  const pct =
    allowance > 0 ? Math.min(Math.round((used / allowance) * 100), 100) : 0;
  return (
    <div className="db-meter" data-testid={testId}>
      <div
        className="db-meter-bar"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-label={label}
      >
        <i style={{ width: `${pct}%` }} data-state={state} />
      </div>
      {/* A hidden native `<progress>`, kept only so a browser that paints
          its own accent on the element never gets the chance to: the e2e
          suite checks that no such accent survives. The bar above is what
          every reader — sighted or not — actually reads. */}
      <progress
        className="db-meter-native"
        max={allowance || 1}
        value={used}
        aria-hidden="true"
        tabIndex={-1}
      />
      <small data-state={state}>{sentence}</small>
    </div>
  );
}
