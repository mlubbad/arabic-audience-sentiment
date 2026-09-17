/**
 * The account page with no Supabase client — the preview build the browser
 * suite runs against, and any deployment without the keys. Signing in is not
 * possible, and the card says so rather than showing a form that would fail
 * on submit; the other half points at the one thing that does work without a
 * session, the dashboard on its fixture.
 *
 * On `ui/` (phase 5): one `db-empty` card at the page measure, the same two
 * halves and the same strings the old `app-state` + `account-story` pair
 * carried. The dashboard door is a plain anchor, as it was — the page is
 * rendered to a string in tests with no router around it.
 */
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import "../pages.css";
import "../pageStates/page-states.css";
import "./account.css";

export function Unavailable() {
  const S = useStrings();
  return (
    <Card className="db-empty db-empty--page" data-testid="account-unavailable">
      <span className="db-empty-symbol" aria-hidden="true">
        ◌
      </span>
      <h2>{S.accountUnavailableTitle}</h2>
      <p className="db-lead">{S.accountUnavailableLead}</p>
      <div className="db-empty-story">
        <h2>{S.accountTryDashboardTitle}</h2>
        <p className="db-lead">{S.accountTryDashboardLead}</p>
        <div className="db-row-actions db-empty-actions">
          <Button asChild>
            <a href="/dashboard">{S.openDashboard}</a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
