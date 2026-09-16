import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Session } from "@supabase/supabase-js";
import type { Budget } from "@sentiment/contracts";
import { configuredMode } from "./data";
import { usePlanUsage } from "./planUsage";
import { planPanelWords, type PlanAction } from "./planPanelWords";
import { openCheckout, openPortal } from "./paddle";
import { contactEmail } from "./pricing";
import { useLocale } from "./locale";
import { useStrings } from "./strings";

/** The plan as the account page shows it: title, renewal, every budget
 *  against its ceiling, what is about to happen to it, and the doors that
 *  are open. The rail card carries one figure so a reader can start work;
 *  this is where the plan is managed, so it carries all of them.
 *
 *  It reads `usage_summary` through the rail card's hook — one query, one
 *  cache entry — for the workspace the reader chose, the same choice the
 *  dashboard and the operations page follow. The session and the workspace
 *  list come from the page, which already holds both. */
export function PlanPanel({
  session,
  workspaces,
  loading,
}: {
  session: Session;
  workspaces: { id: string; name: string }[];
  loading: boolean;
}) {
  const S = useStrings();
  const locale = useLocale();
  const { place, workspaceId, plan } = usePlanUsage(session, workspaces);
  // What the last pressed door had to say: checkout and the portal both
  // fail as a sentence under the buttons, never as a crash.
  const [notice, setNotice] = useState<string | null>(null);
  // Which door is open and not yet answered. A second press while the first
  // is in flight would open two checkouts, so the buttons wait.
  const [pending, setPending] = useState<"manage" | "topup" | null>(null);
  if (configuredMode !== "live") return null;

  const heading = (
    <header>
      <h2 id="plan-panel-heading">{S.planPanelTitle}</h2>
      {place.kind === "ready" ? (
        <p className="rp-sub">{place.name}</p>
      ) : place.kind === "choose" ? (
        <p className="rp-sub">{S.planNoneChosenTitle}</p>
      ) : null}
    </header>
  );
  const shell = (body: ReactNode) => (
    <section
      className="rp-section"
      data-testid="account-plan-panel"
      aria-labelledby="plan-panel-heading"
    >
      {heading}
      {body}
    </section>
  );
  if (loading || (workspaceId && plan.isPending))
    return shell(
      <p className="app-state" role="status">
        {S.planLoading}
      </p>,
    );
  // The page beneath already says there is no workspace and offers to make one.
  if (place.kind === "no_workspaces") return null;
  if (place.kind === "choose")
    return shell(<p className="rp-missing">{S.planNoneChosenNote}</p>);
  if (plan.isError)
    return shell(
      <p className="rp-missing" data-testid="plan-failed">
        <strong>{S.planFailedTitle}</strong>
        {S.planFailedNote}
      </p>,
    );

  const summary = plan.data ?? null;
  const words = planPanelWords(summary, S, locale);
  const budgets: Budget[] = summary?.budgets ?? [];

  const press = (action: "manage" | "topup") => {
    if (!workspaceId || pending) return;
    setNotice(null);
    setPending(action);
    const call =
      action === "manage"
        ? openPortal(session, workspaceId)
        : openCheckout({
            planKey: "pack_10k",
            interval: "month",
            session,
            workspaceId,
          });
    call
      .catch(() => setNotice(S.checkoutUnavailable))
      .finally(() => setPending(null));
  };
  const door = (action: PlanAction) => {
    switch (action) {
      case "upgrade":
        return (
          <Link key={action} to="/pricing" data-action={action}>
            {S.planUpgrade}
          </Link>
        );
      case "contact":
        return (
          <a
            key={action}
            data-action={action}
            href={`mailto:${contactEmail}?subject=${encodeURIComponent(words.title)}`}
          >
            {S.planContact}
          </a>
        );
      case "manage":
      case "topup":
        return (
          <button
            key={action}
            type="button"
            data-action={action}
            disabled={pending !== null}
            onClick={() => press(action)}
          >
            {action === "manage" ? S.planManage : S.planTopup}
          </button>
        );
    }
  };

  return shell(
    <article className="rp-card">
      <h3>{words.title}</h3>
      <p className="rp-sub">{words.statusLine}</p>
      {words.notice && (
        <p className="rp-missing" role="status" data-testid="plan-notice">
          {words.notice}
        </p>
      )}
      {words.rows.length > 0 && (
        <ul className="budgets">
          {words.rows.map((row, i) => {
            const b = budgets[i];
            const finite = b.allowance !== -1;
            const share = finite
              ? b.allowance
                ? Math.min(Math.round((b.used / b.allowance) * 100), 100)
                : 100
              : 0;
            return (
              <li key={b.event_type} data-testid={`plan-${b.event_type}`}>
                <strong>{row.label}</strong>
                <span>{row.line}</span>
                {finite && (
                  <>
                    <progress
                      max={b.allowance || 1}
                      value={b.used}
                      aria-hidden="true"
                    />
                    <small data-state={row.tone}>
                      {S.opsShare(share, S.budgetMessages[row.tone])}
                    </small>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {words.actions.length > 0 && (
        <p className="plan-actions">{words.actions.map(door)}</p>
      )}
      {notice && (
        <p className="account-feedback notice" role="status">
          {notice}
        </p>
      )}
    </article>,
  );
}
