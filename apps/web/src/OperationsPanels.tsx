/**
 * The diagnosis: is collection running, what has it done, what does it cost.
 *
 * Three panels — health, plan, the attempt log — moved here from `Sync.tsx`
 * unchanged, so the page can put the catalogue (the action) above them. This
 * component owns no state and makes no reads: every value it shows is handed
 * in by `SyncBody`, which still holds the one snapshot and the one job read,
 * and the ten browser tests on `/sync?demo=1` see exactly what they saw.
 */
import { budgetState, type SyncState } from "@sentiment/contracts";
import type { deriveSnapshot } from "./data";
import type { Health } from "./syncHealth";
import { displayDate } from "./i18n";
import type { Locale } from "./locale";
import type { Strings } from "./strings";
import { explainCode, type JobEntry, type JobRow } from "./jobFeed";

export function OperationsPanels({
  s,
  health,
  run,
  mode,
  channelId,
  jobs,
  jobsFailed,
  entries,
  acting,
  actionMessage,
  act,
  refresh,
  lang,
  S,
}: {
  s: ReturnType<typeof deriveSnapshot> | undefined;
  health: Health;
  run: SyncState["last_run"] | null;
  mode: "live" | "sanitized_fixture";
  /** The connected channel, or null: the health card says where to connect one. */
  channelId: string | null;
  jobs: JobRow[] | null;
  jobsFailed: boolean;
  entries: JobEntry[];
  acting: string | null;
  actionMessage: string;
  act: (kind: "cancel_job" | "retry_job", id: string) => void;
  refresh: () => void;
  lang: Locale;
  S: Strings;
}) {
  return (
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
                {explainCode(health.errorCode, S) ?? S.opsUnclassifiedFailure} (
                <code>{health.errorCode}</code>)
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
            {/* The remedy used to be a "request sync" button here. It is the
                catalogue now, at the top of this page: choosing a video is
                what starts a collection. What remains is the case where no
                remedy can work — no connected channel — which says where to
                go instead of offering a button that would always fail. */}
            {mode === "live" && !channelId && (
              <div className="sync-actions">
                <p className="muted" data-testid="sync-no-channel">
                  {S.opsNoChannelBefore}{" "}
                  <a href="/account">{S.opsNoChannelLink}</a>{" "}
                  {S.opsNoChannelAfter}
                </p>
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
                    ? Math.min(Math.round((b.used / b.allowance) * 100), 100)
                    : 100;
                  return (
                    <li
                      key={b.event_type}
                      data-testid={`budget-${b.event_type}`}
                    >
                      <strong>
                        {b.event_type === "comment_analysis"
                          ? S.budgetAnalysis
                          : b.event_type === "topic_classification"
                            ? S.budgetTopics
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
          <button type="button" onClick={refresh}>
            {S.refresh}
          </button>
        )}
      </section>
    </>
  );
}
