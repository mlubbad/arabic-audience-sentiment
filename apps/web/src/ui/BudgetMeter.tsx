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
 *
 * An `allowance` of -1 is an internal plan with no ceiling
 * (`unlimited()` in `packages/contracts`'s `usage.ts`) — there is no bound
 * to report, so the bar carries no `aria-valuenow`/`aria-valuemin`/
 * `aria-valuemax` at all rather than a nonsensical `aria-valuemax="-1"`,
 * and draws empty rather than guessing at a share of nothing.
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
  testId?: string;
}) {
  const unlimited = allowance === -1;
  const pct =
    !unlimited && allowance > 0
      ? Math.min(Math.round((used / allowance) * 100), 100)
      : 0;
  return (
    <div className="ui-meter" data-testid={testId}>
      <div
        className="ui-meter-bar"
        role="progressbar"
        aria-valuenow={unlimited ? undefined : Math.min(used, allowance)}
        aria-valuemin={unlimited ? undefined : 0}
        aria-valuemax={unlimited ? undefined : allowance}
        aria-label={label}
      >
        <i style={{ width: `${pct}%` }} data-state={state} />
      </div>
      <small data-state={state}>{sentence}</small>
    </div>
  );
}
