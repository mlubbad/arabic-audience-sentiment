/**
 * The attempt log: every collection job, most recent first, with status filters,
 * summary counts, pagination, and cancel/retry actions.
 */
import { useMemo, useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { Strings } from "../strings";
import type { Locale } from "../locale";
import type { JobEntry, JobRow } from "../jobFeed";
import { displayDate, formatDuration, formatElapsed } from "../i18n";
import { useEffect } from "react";

type AttemptFilter = "all" | "running" | "succeeded" | "failed";

const PAGE_SIZE = 8;

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
  const [filter, setFilter] = useState<AttemptFilter>("all");
  const [page, setPage] = useState(1);
  const [, setTimerTick] = useState(0);

  const hasRunning = entries.some((e) => e.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [hasRunning]);

  const counts = useMemo(() => {
    let running = 0;
    let succeeded = 0;
    let failed = 0;
    for (const e of entries) {
      if (e.status === "running" || e.status === "queued") running++;
      else if (e.status === "succeeded") succeeded++;
      else if (e.status === "failed" || e.status === "blocked") failed++;
    }
    return { total: entries.length, running, succeeded, failed };
  }, [entries]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "running":
        return entries.filter(
          (e) => e.status === "running" || e.status === "queued",
        );
      case "succeeded":
        return entries.filter((e) => e.status === "succeeded");
      case "failed":
        return entries.filter(
          (e) => e.status === "failed" || e.status === "blocked",
        );
      default:
        return entries;
    }
  }, [entries, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <section
      className="db-section"
      id="attempts"
      aria-labelledby="attempts-heading"
    >
      <header>
        <div className="db-attempts-head">
          <div>
            <h2 id="attempts-heading">{S.opsAttemptsTitle}</h2>
            <p className="db-muted">{S.opsAttemptsLead}</p>
          </div>
          {mode === "live" && (
            <Button variant="secondary" size="sm" onClick={refresh}>
              {S.refresh}
            </Button>
          )}
        </div>
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
        <>
          {/* Summary status metrics */}
          <div className="db-attempts-summary">
            <div className="db-attempts-metric">
              <span className="db-attempts-metric-label">
                {S.opsAttemptsCountTotal}
              </span>
              <span className="db-attempts-metric-val">{counts.total}</span>
            </div>
            <div className="db-attempts-metric">
              <span className="db-attempts-metric-label">
                {S.opsAttemptsCountRunning}
              </span>
              <Badge tone={counts.running > 0 ? "warning" : "neutral"} numeric>
                {counts.running}
              </Badge>
            </div>
            <div className="db-attempts-metric">
              <span className="db-attempts-metric-label">
                {S.opsAttemptsCountSucceeded}
              </span>
              <Badge
                tone={counts.succeeded > 0 ? "success" : "neutral"}
                numeric
              >
                {counts.succeeded}
              </Badge>
            </div>
            <div className="db-attempts-metric">
              <span className="db-attempts-metric-label">
                {S.opsAttemptsCountAttention}
              </span>
              <Badge tone={counts.failed > 0 ? "danger" : "neutral"} numeric>
                {counts.failed}
              </Badge>
            </div>
          </div>

          {/* Filter Pills */}
          <div
            className="db-attempts-filters"
            role="tablist"
            aria-label={S.opsAttemptsTitle}
          >
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`db-attempts-pill ${filter === "all" ? "is-active" : ""}`}
              onClick={() => {
                setFilter("all");
                setPage(1);
              }}
            >
              {S.opsAttemptsFilterAll} ({counts.total})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "running"}
              className={`db-attempts-pill ${filter === "running" ? "is-active" : ""}`}
              onClick={() => {
                setFilter("running");
                setPage(1);
              }}
            >
              {S.opsAttemptsFilterRunning} ({counts.running})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "succeeded"}
              className={`db-attempts-pill ${filter === "succeeded" ? "is-active" : ""}`}
              onClick={() => {
                setFilter("succeeded");
                setPage(1);
              }}
            >
              {S.opsAttemptsFilterSucceeded} ({counts.succeeded})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "failed"}
              className={`db-attempts-pill ${filter === "failed" ? "is-active" : ""}`}
              onClick={() => {
                setFilter("failed");
                setPage(1);
              }}
            >
              {S.opsAttemptsFilterFailed} ({counts.failed})
            </button>
          </div>

          {/* List of attempts */}
          {paged.length === 0 ? (
            <p className="db-missing" style={{ margin: "var(--space-3) 0" }}>
              {S.opsAttemptsNoMatch}
            </p>
          ) : (
            <ul className="db-attempts" data-testid="attempts">
              {paged.map((e) => (
                <li key={e.id} data-severity={e.severity}>
                  <Card className="db-attempt">
                    <div className="db-attempt-head">
                      <strong>{e.headline}</strong>
                      <Badge
                        tone={
                          e.severity === "ok"
                            ? "success"
                            : e.severity === "critical"
                              ? "danger"
                              : e.severity === "warning"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {e.status}
                      </Badge>
                    </div>
                    <span>{e.detail}</span>
                    <small>
                      {displayDate(e.createdAt, lang)}
                      {e.attempt > 0 ? S.opsAttemptN(e.attempt) : ""}
                      {e.status === "running"
                        ? S.opsRunningDuration(formatElapsed(e.createdAt, lang))
                        : e.durationSeconds != null
                          ? S.opsCompletedDuration(
                              formatDuration(e.durationSeconds, lang),
                            )
                          : ""}
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

          {/* Pagination Navigation */}
          {totalPages > 1 && (
            <nav
              className="db-pager db-attempts-pager"
              aria-label={S.opsAttemptsPageOf(currentPage, totalPages)}
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                {S.previousPage}
              </Button>
              <p>{S.opsAttemptsPageOf(currentPage, totalPages)}</p>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                {S.nextPage}
              </Button>
            </nav>
          )}
        </>
      )}

      {actionMessage && (
        <p role="status" data-testid="job-action">
          {actionMessage}
        </p>
      )}
    </section>
  );
}
