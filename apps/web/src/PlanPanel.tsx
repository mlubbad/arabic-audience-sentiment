import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { UsageSummarySchema, type Budget } from "@sentiment/contracts";
import { useWorkspaceSelection } from "./workspaceSelection";
import { workspaceState } from "./workspace";
import { configuredMode, fixtureWorkspace } from "./data";
import { planPanelWords, type PlanAction } from "./planPanelWords";
import { openCheckout, openPortal } from "./paddle";
import { contactEmail } from "./pricing";
import { useLocale } from "./locale";
import { useStrings } from "./strings";
import { supabase } from "./supabase";

/** The plan as the account page shows it: title, renewal, every budget
 *  against its ceiling, what is about to happen to it, and the doors that
 *  are open. The rail card carries one figure so a reader can start work;
 *  this is where the plan is managed, so it carries all of them.
 *
 *  It reads `usage_summary` with the rail card's query — same key, so the
 *  two share one cache entry — for the workspace the reader chose, the same
 *  choice the dashboard and the operations page follow. The session and the
 *  workspace list come from the page, which already holds both. */
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
  const [chosen] = useWorkspaceSelection(session.user.id);
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: true,
    workspaces,
    selectedId: chosen,
  });
  const workspaceId = place.kind === "ready" ? place.id : null;
  const plan = useQuery({
    queryKey: ["plan", session.user.id, workspaceId],
    enabled: !!supabase && !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("usage_summary", {
        w: workspaceId,
      });
      if (error) throw new Error("plan_unavailable");
      return UsageSummarySchema.nullable().parse(data);
    },
  });
  // What the last pressed door had to say: checkout and the portal both
  // fail as a sentence under the buttons, never as a crash.
  const [notice, setNotice] = useState<string | null>(null);
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
      data-testid="plan-panel"
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
    if (!workspaceId) return;
    setNotice(null);
    const call =
      action === "manage"
        ? openPortal(session, workspaceId)
        : openCheckout({
            planKey: "pack_10k",
            interval: "month",
            session,
            workspaceId,
          });
    call.catch(() => setNotice(S.checkoutUnavailable));
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
                {/* "1 of unlimited" is not a sentence: with no ceiling the
                    row says what was used and that nothing caps it. */}
                <span>
                  {finite
                    ? S.planUsedOf(row.used, row.allowance)
                    : `${row.used} · ${row.allowance}`}
                </span>
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
