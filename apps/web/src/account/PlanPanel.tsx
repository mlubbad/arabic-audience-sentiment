import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Session } from "@supabase/supabase-js";
import {
  budgetState,
  type Budget,
  type UsageSummary,
} from "@sentiment/contracts";
import { configuredMode } from "../data";
import { usePlanUsage } from "../planUsage";
import { planPanelWords, type PlanAction } from "../planPanelWords";
import { openCheckout, openPortal } from "../paddle";
import { contactEmail } from "../pricing";
import { useLocale } from "../locale";
import { useStrings } from "../strings";
import type { WorkspaceState } from "../workspace";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { BudgetMeter } from "../ui/BudgetMeter";
import "./account.css";

/** What the plan as the account page shows it needs from its caller: which
 *  workspace it is for, what `usage_summary` said (or would say once it
 *  answers), and what the last pressed door printed underneath. Split out of
 *  `PlanPanel` so the whole of the rendering — every branch a workspace's
 *  state and a query's state can be in — is one pure component, testable
 *  with plain props and no `usePlanUsage`, no session, no Paddle. */
export type PlanPanelViewProps = {
  place: WorkspaceState;
  usage: UsageSummary | null;
  loading: boolean;
  failed: boolean;
  /** Called only for `manage`/`topup` — `upgrade` and `contact` are doors
   *  that leave the page (a `Link`, a `mailto:` anchor) and never reach it. */
  onPress: (action: "manage" | "topup") => void;
  /** The last pressed door's answer, printed under the doors as a status
   *  line — a Paddle refusal in the live panel, `S.demoExternalNote` in the
   *  demo one. */
  pressNote: string | null;
  /** Disables `manage`/`topup` while a press is in flight. The demo panel
   *  never sets this: nothing it does is asynchronous. */
  busy?: boolean;
};

/** The plan as the account page shows it: title, renewal, every budget
 *  against its ceiling, what is about to happen to it, and the doors that
 *  are open. The rail card carries one figure so a reader can start work;
 *  this is where the plan is managed, so it carries all of them.
 *
 *  Every bounded budget gets a `BudgetMeter` — the same component `/sync`
 *  renders, so the two pages can never disagree about what a given share or
 *  state looks like; an unlimited one prints its line with no bar, as this
 *  panel always did — and the meter's sentence is built the same way this panel
 *  always built it (`S.opsShare` over `budgetState`), not `PlanBudgets`'s own
 *  `S.opsBudgetLine`: the two pages agree on the widget, not on every word
 *  around it. */
export function PlanPanelView({
  place,
  usage,
  loading,
  failed,
  onPress,
  pressNote,
  busy = false,
}: PlanPanelViewProps) {
  const S = useStrings();
  const locale = useLocale();

  const shell = (body: ReactNode) => (
    <Card data-testid="account-plan-panel" aria-labelledby="plan-panel-heading">
      <header>
        <h2 id="plan-panel-heading">{S.planPanelTitle}</h2>
        {place.kind === "ready" ? (
          <p className="db-muted">{place.name}</p>
        ) : place.kind === "choose" ? (
          <p className="db-muted">{S.planNoneChosenTitle}</p>
        ) : null}
      </header>
      {body}
    </Card>
  );

  if (loading)
    return shell(
      <p role="status" className="db-muted">
        {S.planLoading}
      </p>,
    );
  // The page beneath already says there is no workspace and offers to make one.
  if (place.kind === "no_workspaces") return null;
  if (place.kind === "choose")
    return shell(<p className="db-missing">{S.planNoneChosenNote}</p>);
  if (failed)
    return shell(
      <p className="db-missing" role="alert" data-testid="plan-failed">
        <strong>{S.planFailedTitle}</strong>
        {S.planFailedNote}
      </p>,
    );

  const words = planPanelWords(usage, S, locale);
  const budgets: Budget[] = usage?.budgets ?? [];

  const door = (action: PlanAction, primary: boolean) => {
    switch (action) {
      case "upgrade":
        return (
          <Button
            key={action}
            asChild
            variant={primary ? "primary" : "secondary"}
            data-action={action}
          >
            <Link to="/pricing">{S.planUpgrade}</Link>
          </Button>
        );
      case "contact":
        return (
          <Button
            key={action}
            asChild
            variant={primary ? "primary" : "secondary"}
            data-action={action}
          >
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(words.title)}`}
            >
              {S.planContact}
            </a>
          </Button>
        );
      case "manage":
      case "topup":
        return (
          <Button
            key={action}
            variant={primary ? "primary" : "secondary"}
            data-action={action}
            disabled={busy}
            onClick={() => onPress(action)}
          >
            {action === "manage" ? S.planManage : S.planTopup}
          </Button>
        );
    }
  };

  return shell(
    <article className="db-plan-body">
      <h3>{words.title}</h3>
      <p className="db-muted">{words.statusLine}</p>
      {words.notice && (
        <p className="db-missing" role="status" data-testid="plan-notice">
          {words.notice}
        </p>
      )}
      {words.rows.length > 0 && (
        <ul className="db-plan-budgets" role="list">
          {words.rows.map((row, i) => {
            const b = budgets[i];
            const state = budgetState(b);
            const finite = b.allowance !== -1;
            const share = finite
              ? b.allowance
                ? Math.min(Math.round((b.used / b.allowance) * 100), 100)
                : 100
              : 0;
            return (
              <li key={b.event_type} data-testid={`plan-${b.event_type}`}>
                <strong>{row.label}</strong>
                <span className="db-plan-budget-line">{row.line}</span>
                {finite && (
                  <BudgetMeter
                    used={b.used}
                    allowance={b.allowance}
                    state={state}
                    label={row.label}
                    sentence={S.opsShare(share, S.budgetMessages[state])}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {words.actions.length > 0 && (
        <div className="db-actions">
          {words.actions.map((action, i) => door(action, i === 0))}
        </div>
      )}
      {pressNote && (
        <p className="db-plan-feedback" role="status">
          {pressNote}
        </p>
      )}
    </article>,
  );
}

/** The demo path: the fixture and `reduceAccountDemo` already resolved
 *  `usage`/`place` above this component, in the page — there is no query to
 *  be pending or to fail, and `manage`/`topup` cannot reach Paddle from a
 *  session that does not exist. Pressing either says so instead of leaving,
 *  the one behaviour this path adds over the pure view. */
export function DemoPlanPanel({
  demo,
}: {
  demo: { usage: UsageSummary | null; place: WorkspaceState };
}) {
  const S = useStrings();
  const [note, setNote] = useState<string | null>(null);
  return (
    <PlanPanelView
      place={demo.place}
      usage={demo.usage}
      loading={false}
      failed={false}
      onPress={() => setNote(S.demoExternalNote)}
      pressNote={note}
    />
  );
}

/** The live path, unchanged from the panel this replaces: one query for the
 *  workspace the reader chose, shared with the rail card through the same
 *  cache key (`usePlanUsage`). Hidden outright on a build that is not
 *  serving live data — the same guard the panel always carried. */
function LivePlanPanel({
  session,
  workspaces,
  loading,
}: {
  session: Session;
  workspaces: { id: string; name: string }[];
  loading: boolean;
}) {
  const S = useStrings();
  const { place, workspaceId, plan } = usePlanUsage(session, workspaces);
  // What the last pressed door had to say: checkout and the portal both
  // fail as a sentence under the buttons, never as a crash.
  const [notice, setNotice] = useState<string | null>(null);
  // Which door is open and not yet answered. A second press while the first
  // is in flight would open two checkouts, so the buttons wait.
  const [pending, setPending] = useState<"manage" | "topup" | null>(null);
  if (configuredMode !== "live") return null;

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
      .catch((error: unknown) =>
        setNotice(
          (error as Error)?.message === "no_paddle_customer"
            ? S.portalNoCustomer
            : S.checkoutUnavailable,
        ),
      )
      .finally(() => setPending(null));
  };

  return (
    <PlanPanelView
      place={place}
      usage={plan.data ?? null}
      loading={loading || (!!workspaceId && plan.isPending)}
      failed={plan.isError}
      onPress={press}
      pressNote={notice}
      busy={pending !== null}
    />
  );
}

/** It reads `usage_summary` through the rail card's hook — one query, one
 *  cache entry — for the workspace the reader chose, the same choice the
 *  dashboard and the operations page follow. The session and the workspace
 *  list come from the page, which already holds both.
 *
 *  `demo` switches to the account demo's fixture and reducer instead:
 *  `usePlanUsage` is never called on that path, because a hook cannot be
 *  called conditionally inside one component — `LivePlanPanel` and
 *  `DemoPlanPanel` are two components for exactly that reason, and this
 *  function only ever mounts one of them. */
export function PlanPanel(props: {
  session: Session;
  workspaces: { id: string; name: string }[];
  loading: boolean;
  demo?: { usage: UsageSummary | null; place: WorkspaceState };
}) {
  if (props.demo) return <DemoPlanPanel demo={props.demo} />;
  return (
    <LivePlanPanel
      session={props.session}
      workspaces={props.workspaces}
      loading={props.loading}
    />
  );
}
