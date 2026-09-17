/**
 * The plan's budgets: one `BudgetMeter` per event type, on the shared card.
 *
 * Split out of `OperationsPanels.tsx`, unchanged in behaviour — `budgetState`
 * still decides the state, `opsShare`/`opsBudgetLine` still say what it
 * means; only the bar moved into `BudgetMeter`, off the native `<progress>`
 * a browser used to paint its own colour onto.
 */
import { budgetState } from "@sentiment/contracts";
import { Card } from "../ui/Card";
import { BudgetMeter } from "./BudgetMeter";
import type { deriveSnapshot } from "../data";
import { displayDate } from "../i18n";
import type { Locale } from "../locale";
import type { Strings } from "../strings";

export function PlanBudgets({
  plan,
  lang,
  S,
}: {
  plan: ReturnType<typeof deriveSnapshot>["plan"] | undefined;
  lang: Locale;
  S: Strings;
}) {
  return (
    <section
      className="db-section"
      aria-labelledby="plan-heading"
      data-testid="plan-panel"
    >
      <header>
        <h2 id="plan-heading">{S.opsPlanTitle}</h2>
      </header>
      {plan == null ? (
        <p className="db-missing" data-testid="plan-none">
          <strong>{S.opsNoPlanStrong}</strong>
          {S.opsNoPlanLead}
        </p>
      ) : (
        <Card>
          <p className="db-muted">
            {S.opsPlanPeriod(
              plan.plan_key,
              displayDate(plan.period_start, lang),
              displayDate(plan.period_end, lang),
            )}
          </p>
          <ul className="db-budgets">
            {plan.budgets.map((b) => {
              const state = budgetState(b);
              const share = b.allowance
                ? Math.min(Math.round((b.used / b.allowance) * 100), 100)
                : 100;
              const label =
                b.event_type === "comment_analysis"
                  ? S.budgetAnalysis
                  : b.event_type === "topic_classification"
                    ? S.budgetTopics
                    : S.budgetBackfill;
              return (
                <li
                  key={b.event_type}
                  className="db-budget"
                  data-testid={`budget-${b.event_type}`}
                >
                  <strong>{label}</strong>
                  <span className="db-budget-line">
                    {S.opsBudgetLine(b.used, b.allowance, b.remaining)}
                  </span>
                  <BudgetMeter
                    used={b.used}
                    allowance={b.allowance}
                    state={state}
                    label={label}
                    sentence={S.opsShare(share, S.budgetMessages[state])}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
