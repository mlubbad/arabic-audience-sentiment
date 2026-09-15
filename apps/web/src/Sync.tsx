/**
 * Operations: is collection running, what has it done, and what does it cost.
 *
 * These panels used to sit at the bottom of the analytics dashboard, below the
 * charts. That was the wrong place for a specific reason: "no sync has run"
 * qualifies every figure above it, and a caveat printed *after* the numbers
 * arrives once the reader has already believed them. A warning belongs before
 * what it limits, and the dashboard answers a different question — what the
 * audience said — for a reader who is not asking whether the machine is up.
 *
 * It reads the same snapshot the dashboard reads, through the same mode
 * decision, so the demo has an operations page too and the two can never
 * disagree about what the sync state is.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { budgetState } from "@sentiment/contracts";
import {
  configuredMode,
  fixtureWorkspace,
  loadSnapshot,
  resolveMode,
} from "./data";
import { supabase } from "./supabase";
import { useSession, useWorkspaces } from "./session";
import { useWorkspaceSelection } from "./workspaceSelection";
import { WorkspaceGate } from "./WorkspaceGate";
import {
  workspaceState,
  readableWorkspace,
  type WorkspaceOption,
} from "./workspace";
import { syncHealth } from "./syncHealth";
import { displayDate } from "./i18n";
import { useLocale } from "./locale";
import { useStrings } from "./strings";
import {
  describeJob,
  explainCode,
  type JobEntry,
  type JobRow,
} from "./jobFeed";
import "./report.css";

export function Sync() {
  const { session, loading: sessionLoading } = useSession();
  const {
    workspaces,
    loading: workspacesLoading,
    failed: workspacesFailed,
  } = useWorkspaces(session);
  // One selection for the whole product. This was `useState(null)` here
  // and again in the other page; both routes are lazy, so the answer died
  // on every navigation and the question came back.
  const [chosen, setChosen] = useWorkspaceSelection(session?.user.id ?? null, {
    route: true,
  });
  const S = useStrings();
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  // An explicit way in to the demo of this page. Not a workaround for the line
  // below: the fixture operations page is the only surface on which the
  // product's hardest guarantees can be exercised without a live account —
  // that a stalled queue does not read as a healthy last run, that a partial
  // collection is not presented as a complete one, that a malformed sync block
  // reads as unknown rather than fine. Ten browser tests live on it.
  //
  // So the page stays available and stops being what a stranger is handed.
  const wantsDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");

  // A visitor who has not signed in has no collection to be the health of.
  //
  // This page used to render the fixture's operating state to them, which is a
  // worker that is not connected and a plan at 74% — so the first thing a
  // stranger saw of the product was a red line saying nothing had run and an
  // amber one saying a limit was near, about a machine that is not theirs and
  // is not in trouble. Two of the three panels then said, in effect, that they
  // were empty because this is a demo.
  //
  // The dashboard is a different case and keeps its demo: a sanitized report
  // shows what the product produces, and that is the thing worth showing. An
  // operations page answers a question only an owner has.
  const signedOut = !session && !wantsDemo && (
    <div className="app-state" data-testid="sync-signed-out">
      <span className="app-state-symbol" aria-hidden="true">
        ⟳
      </span>
      <p className="app-eyebrow">{S.opsEyebrow}</p>
      {/* The page keeps its name whether you are signed in or not. The first
            draft of this state led with a sentence about the page instead —
            "هذه الصفحة تتبع تشغيل قناتك" — and a browser test caught it: a
            reader who arrives from a menu item called "حالة المزامنة" should
            land on a heading that agrees with the thing they clicked. */}
      <h1>{S.opsTitle}</h1>
      <p>{S.opsSignedOutLead}</p>
      <div className="app-state-actions">
        <a href="/account">{S.opsSignInOrJoin}</a>
        <a href="/sync?demo=1">{S.opsSeeDemo}</a>
      </div>
    </div>
  );
  const live = readableWorkspace(place);
  const mode = resolveMode({ signedIn: !!session, workspace: live });
  const workspaceId = mode === "live" && live ? live : fixtureWorkspace;
  const userId = session?.user.id ?? "visitor";
  return (
    <WorkspaceGate
      sessionLoading={sessionLoading}
      live={configuredMode === "live" && !!session}
      workspacesLoading={workspacesLoading}
      workspacesFailed={workspacesFailed}
      place={place}
      chosen={chosen}
      onChoose={setChosen}
      words={{
        eyebrow: S.gateOperationsEyebrow,
        chooseTitle: S.gateOperationsTitle,
        chooseLead: S.gateOperationsLead,
        chooseTestId: "sync-ws-choose",
      }}
    >
      {signedOut || (
        <SyncBody
          key={`${userId}:${mode}:${workspaceId}`}
          userId={userId}
          mode={mode}
          workspaceId={workspaceId}
          workspaceName={place.kind === "ready" ? place.name : null}
          options={place.kind === "ready" ? place.options : []}
          onChoose={setChosen}
        />
      )}
    </WorkspaceGate>
  );
}

function SyncBody({
  userId,
  mode,
  workspaceId,
  workspaceName,
  options,
  onChoose,
}: {
  userId: string;
  mode: "live" | "sanitized_fixture";
  workspaceId: string;
  workspaceName: string | null;
  options: WorkspaceOption[];
  onChoose: (id: string) => void;
}) {
  const S = useStrings();
  const lang = useLocale();
  const snapshot = useQuery({
    queryKey: ["sync-snapshot", userId, mode, workspaceId],
    queryFn: ({ signal }) =>
      loadSnapshot(mode, { workspace_id: workspaceId }, signal),
  });

  // The attempt log is a live-only thing: the fixture has no job table, and
  // inventing one would put a plausible history on screen for a demo.
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobsFailed, setJobsFailed] = useState(false);
  // The channel, read here for one reason: this page is where a reader learns
  // that nothing has collected, and the only button that starts a collection
  // was on the account page. Being told "لم تُنفَّذ أي مزامنة" by a screen
  // that cannot start one leaves the reader to guess where the remedy lives.
  const [channelId, setChannelId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  // Both are refused by the database for a job in the wrong state or another
  // tenant's workspace; the buttons only avoid offering what will be refused.
  const act = (kind: "cancel_job" | "retry_job", id: string) => {
    if (!supabase) return;
    setActing(id);
    setActionMessage("");
    void supabase.rpc(kind, { w: workspaceId, j: id }).then(({ error }) => {
      setActing(null);
      setActionMessage(
        error
          ? kind === "cancel_job"
            ? S.opsCancelFailed
            : S.opsRetryFailed
          : kind === "cancel_job"
            ? S.opsCancelled
            : S.opsRetried,
      );
      setTick((t) => t + 1);
      void snapshot.refetch();
    });
  };
  const requestSync = () => {
    if (!supabase || !channelId) return;
    setActing("enqueue");
    setActionMessage("");
    void supabase
      .rpc("enqueue_sync", {
        w: workspaceId,
        c: channelId,
        // Not a timestamp. The database holds one outstanding collection per
        // channel and answers a repeat with the job already waiting; a key
        // that changes on every click asks it for a new one each time.
        k: `sync-page-${workspaceId}`,
      })
      .then(({ error }) => {
        setActing(null);
        // Never "أُضيفت": a second click is answered with the first job, and
        // claiming a new one was queued would be false on every click but one.
        setActionMessage(
          error ? S.opsSyncRequestFailed : S.opsSyncRequestStanding,
        );
        setTick((t) => t + 1);
        void snapshot.refetch();
      });
  };
  useEffect(() => {
    if (!supabase || mode !== "live") {
      setJobs(null);
      setChannelId(null);
      return;
    }
    const db = supabase;
    let active = true;
    void db
      .from("connection_status")
      .select("channel_id,status")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        if (!active) return;
        const connectedChannel = (data ?? []).find(
          (c) => c.status === "connected",
        );
        setChannelId(connectedChannel?.channel_id ?? null);
      });
    void db
      .from("jobs")
      .select("id,status,attempt,error_code,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        setJobsFailed(!!error);
        setJobs(error ? [] : ((data ?? []) as JobRow[]));
      });
    return () => {
      active = false;
    };
  }, [mode, workspaceId, tick]);

  const s = snapshot.data;
  const health = syncHealth(s?.sync ?? null, new Date());
  const run = s?.sync?.last_run ?? null;
  const connected = !!s?.sync?.worker.connected;
  const entries: JobEntry[] = (jobs ?? []).map((j) =>
    describeJob(j, { workerConnected: connected }, S),
  );

  return (
    <div className="rp-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">
          {S.opsEyebrow} · {workspaceName ?? S.opsDemoTag}
        </p>
        <h1>{S.opsTitle}</h1>
        {/* The one sentence that orients — this page against the other one.
            "تابع … من مكان واحد" was a pitch and is gone. */}
        <p>{S.opsLead}</p>
      </header>
      {mode === "live" ? (
        <div className="sync-workspace">
          <p>
            {S.opsWorkspaceData} <strong>{workspaceName}</strong>
          </p>
          {options.length > 1 && (
            <label>
              {S.workspaceLabel}
              <select
                aria-label={S.changeWorkspace}
                value={workspaceId}
                onChange={(e) => onChoose(e.target.value)}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <p className="sync-demo">{S.opsDemoNote}</p>
      )}

      {snapshot.isPending ? (
        <p role="status">{S.opsReading}</p>
      ) : snapshot.isError ? (
        <div role="alert" className="notice">
          <p>{S.opsReadFailed}</p>
          <button type="button" onClick={() => void snapshot.refetch()}>
            {S.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="sync-grid">
            <section
              className="rp-section"
              aria-labelledby="sync-heading"
              data-testid="sync-panel"
            >
              <header>
                <h2 id="sync-heading">{S.opsHealthTitle}</h2>
              </header>
              <article className="rp-card">
                <p data-testid="sync-state" data-severity={health.severity}>
                  <strong>{S.syncMessages[health.key]}</strong>
                </p>
                {health.errorCode && (
                  <p data-testid="sync-error">
                    {explainCode(health.errorCode, S) ??
                      S.opsUnclassifiedFailure}{" "}
                    (<code>{health.errorCode}</code>)
                  </p>
                )}
                {health.queued > 0 && (
                  <p data-testid="sync-queued">{S.opsQueued(health.queued)}</p>
                )}
                <p data-testid="sync-worker">
                  {S.opsWorkerLabel}{" "}
                  {s?.sync?.worker.connected
                    ? S.opsWorkerConnected(
                        displayDate(s.sync.worker.last_heartbeat_at, lang),
                      )
                    : S.opsWorkerDisconnected}
                </p>
                {/* The remedy, beside the diagnosis. Offered only when it can
                    work: without a connected channel the server refuses, and a
                    button that always fails is worse than no button — so that
                    case says where to go instead. */}
                {mode === "live" && (
                  <div className="sync-actions">
                    {channelId ? (
                      <button
                        type="button"
                        data-testid="sync-request"
                        disabled={acting === "enqueue"}
                        onClick={requestSync}
                      >
                        {acting === "enqueue" ? S.opsRequesting : S.requestSync}
                      </button>
                    ) : (
                      <p className="muted" data-testid="sync-no-channel">
                        {S.opsNoChannelBefore}{" "}
                        <a href="/account">{S.opsNoChannelLink}</a>{" "}
                        {S.opsNoChannelAfter}
                      </p>
                    )}
                  </div>
                )}
                {run ? (
                  <p data-testid="sync-last-run">
                    {S.opsLastRun(
                      displayDate(run.started_at, lang),
                      run.source,
                      run.coverage.videos_seen,
                      run.coverage.comments_collected,
                    )}{" "}
                    {run.coverage.complete
                      ? S.opsTraversalComplete
                      : S.opsTraversalUnproven}
                  </p>
                ) : (
                  <p data-testid="sync-last-run">{S.opsNoPreviousRun}</p>
                )}
              </article>
            </section>

            <section
              className="rp-section"
              aria-labelledby="plan-heading"
              data-testid="plan-panel"
            >
              <header>
                <h2 id="plan-heading">{S.opsPlanTitle}</h2>
              </header>
              {s?.plan == null ? (
                <p className="rp-missing" data-testid="plan-none">
                  <strong>{S.opsNoPlanStrong}</strong>
                  {S.opsNoPlanLead}
                </p>
              ) : (
                <article className="rp-card">
                  <p className="rp-sub">
                    {S.opsPlanPeriod(
                      s.plan.plan_key,
                      displayDate(s.plan.period_start, lang),
                      displayDate(s.plan.period_end, lang),
                    )}
                  </p>
                  <ul className="budgets">
                    {s.plan.budgets.map((b) => {
                      const state = budgetState(b);
                      const share = b.allowance
                        ? Math.min(
                            Math.round((b.used / b.allowance) * 100),
                            100,
                          )
                        : 100;
                      return (
                        <li
                          key={b.event_type}
                          data-testid={`budget-${b.event_type}`}
                        >
                          <strong>
                            {b.event_type === "comment_analysis"
                              ? S.budgetAnalysis
                              : S.budgetBackfill}
                          </strong>
                          <span>
                            {S.opsBudgetLine(b.used, b.allowance, b.remaining)}
                          </span>
                          <progress
                            max={b.allowance || 1}
                            value={b.used}
                            aria-hidden="true"
                          />
                          <small data-state={state}>
                            {S.opsShare(share, S.budgetMessages[state])}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              )}
            </section>
          </div>

          <section className="rp-section" id="rp-attempts">
            <header>
              <h2>{S.opsAttemptsTitle}</h2>
              <p className="rp-sub">{S.opsAttemptsLead}</p>
            </header>
            {mode !== "live" ? (
              <p className="rp-missing">
                <strong>{S.opsDemoNoLogStrong}</strong>
                {S.opsDemoNoLogLead}
              </p>
            ) : jobsFailed ? (
              <p className="rp-missing" data-testid="jobs-failed">
                <strong>{S.opsLogFailedStrong}</strong>
                {S.opsLogFailedLead}
              </p>
            ) : jobs === null ? (
              <p role="status">{S.opsLogReading}</p>
            ) : entries.length === 0 ? (
              <p className="rp-missing">
                <strong>{S.opsNoAttemptsStrong}</strong>
                {S.opsNoAttemptsLead}
              </p>
            ) : (
              <ul className="history" data-testid="attempts">
                {entries.map((e) => (
                  <li key={e.id} data-severity={e.severity}>
                    <strong>{e.headline}</strong>
                    <span>{e.detail}</span>
                    <small>
                      {displayDate(e.createdAt, lang)}
                      {e.attempt > 0 ? S.opsAttemptN(e.attempt) : ""}
                    </small>
                    {e.cancellable && (
                      <button
                        type="button"
                        className="rp-tab"
                        disabled={acting === e.id}
                        data-testid={`cancel-${e.id}`}
                        onClick={() => act("cancel_job", e.id)}
                      >
                        {S.opsCancel}
                      </button>
                    )}
                    {e.retryable && (
                      <button
                        type="button"
                        className="rp-tab"
                        disabled={acting === e.id}
                        data-testid={`retry-${e.id}`}
                        onClick={() => act("retry_job", e.id)}
                      >
                        {S.retry}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {actionMessage && (
              <p role="status" data-testid="job-action">
                {actionMessage}
              </p>
            )}
            {mode === "live" && (
              <button
                type="button"
                onClick={() => {
                  setTick((t) => t + 1);
                  void snapshot.refetch();
                }}
              >
                {S.refresh}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export default Sync;
