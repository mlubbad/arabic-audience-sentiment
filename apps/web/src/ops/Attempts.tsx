/**
 * The attempt log: every collection job, most recent first, with a cancel
 * or a retry where one applies.
 *
 * Split out of `OperationsPanels.tsx`, unchanged in behaviour — `describeJob`
 * (in `Sync.tsx`) still turns a job row into the sentence and the two
 * booleans this reads; only the row moved onto `Card` and the buttons onto
 * `Button` (`ghost sm`, the same pair `CommentsTable`'s row actions use).
 */
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { Strings } from "../strings";
import type { Locale } from "../locale";
import type { JobEntry, JobRow } from "../jobFeed";
import { displayDate } from "../i18n";

export function Attempts({
  mode,
  jobsFailed,
  jobs,
  entries,
  lang,
  acting,
  actionMessage,
  act,
  refresh,
  S,
}: {
  mode: "live" | "sanitized_fixture";
  jobsFailed: boolean;
  jobs: JobRow[] | null;
  entries: JobEntry[];
  lang: Locale;
  acting: string | null;
  actionMessage: string;
  act: (kind: "cancel_job" | "retry_job", id: string) => void;
  refresh: () => void;
  S: Strings;
}) {
  return (
    <section
      className="db-section"
      id="attempts"
      aria-labelledby="attempts-heading"
    >
      <header>
        <h2 id="attempts-heading">{S.opsAttemptsTitle}</h2>
        <p className="db-muted">{S.opsAttemptsLead}</p>
      </header>
      {mode !== "live" ? (
        <p className="db-missing">
          <strong>{S.opsDemoNoLogStrong}</strong>
          {S.opsDemoNoLogLead}
        </p>
      ) : jobsFailed ? (
        <p className="db-missing" data-testid="jobs-failed">
          <strong>{S.opsLogFailedStrong}</strong>
          {S.opsLogFailedLead}
        </p>
      ) : jobs === null ? (
        <p role="status">{S.opsLogReading}</p>
      ) : entries.length === 0 ? (
        <p className="db-missing">
          <strong>{S.opsNoAttemptsStrong}</strong>
          {S.opsNoAttemptsLead}
        </p>
      ) : (
        <ul className="db-attempts" data-testid="attempts">
          {entries.map((e) => (
            <li key={e.id} data-severity={e.severity}>
              <Card className="db-attempt">
                <strong>{e.headline}</strong>
                <span>{e.detail}</span>
                <small>
                  {displayDate(e.createdAt, lang)}
                  {e.attempt > 0 ? S.opsAttemptN(e.attempt) : ""}
                </small>
                {(e.cancellable || e.retryable) && (
                  <div className="db-row-actions">
                    {e.cancellable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={acting === e.id}
                        data-testid={`cancel-${e.id}`}
                        onClick={() => act("cancel_job", e.id)}
                      >
                        {S.opsCancel}
                      </Button>
                    )}
                    {e.retryable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={acting === e.id}
                        data-testid={`retry-${e.id}`}
                        onClick={() => act("retry_job", e.id)}
                      >
                        {S.retry}
                      </Button>
                    )}
                  </div>
                )}
              </Card>
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
        <Button variant="secondary" size="sm" onClick={refresh}>
          {S.refresh}
        </Button>
      )}
    </section>
  );
}
