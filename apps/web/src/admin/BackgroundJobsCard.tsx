/**
 * The System page's card for scheduled database work (20261025000000): each
 * cron job's last finished run and its failures over 24 hours, and how far the
 * comparison recount and the comment-count correction have got. Until this
 * card, a job failing every ten minutes for days showed nowhere in the
 * console (2026-10-13).
 */
import { useQuery } from "@tanstack/react-query";
import type { AdminBackgroundJob } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { readAdminBackgroundJobs } from "./adminRead";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function BackgroundJobsCard({ enabled }: { enabled: boolean }) {
  const S = useStrings();
  const jobs = useQuery({
    queryKey: ["admin", "background-jobs"],
    queryFn: () => readAdminBackgroundJobs(),
    enabled,
  });

  let body;
  if (jobs.isError)
    body = <p className="admin-account-muted">{S.adminSystemUnread}</p>;
  else if (!jobs.data) body = null;
  else {
    const { compare, stats } = jobs.data;
    body = (
      <>
        <p className="admin-system-chips" data-testid="admin-jobs-compare">
          <span>{S.adminJobsCompare(compare.counted, compare.channels)}</span>
          {compare.never_counted > 0 && (
            <Badge tone="neutral">
              {S.adminJobsNeverCounted(compare.never_counted)}
            </Badge>
          )}
          {compare.failing > 0 && (
            <Badge tone="danger" title={compare.last_error ?? undefined}>
              {S.adminJobsFailing(compare.failing)}
            </Badge>
          )}
        </p>
        <p className="admin-system-chips" data-testid="admin-jobs-stats">
          <span>
            {S.adminJobsStats(stats.reconciled_24h, stats.workspaces)}
          </span>
          {stats.failing > 0 && (
            <Badge tone="danger" title={stats.last_error ?? undefined}>
              {S.adminJobsFailing(stats.failing)}
            </Badge>
          )}
        </p>
        {jobs.data.cron_available ? (
          <ul className="admin-account-history" data-testid="admin-jobs">
            {jobs.data.jobs.map((j) => (
              <Job key={j.name} job={j} />
            ))}
          </ul>
        ) : (
          <p className="admin-account-muted">{S.adminJobsUnavailable}</p>
        )}
      </>
    );
  }

  return (
    <Card className="admin-home-card admin-jobs-card">
      <h2>{S.adminJobsTitle}</h2>
      <p className="admin-account-muted">{S.adminJobsLead}</p>
      {body}
    </Card>
  );
}

function Job({ job }: { job: AdminBackgroundJob }) {
  const S = useStrings();
  const state = !job.active ? (
    <Badge tone="neutral">{S.adminJobsInactive}</Badge>
  ) : job.last_status === "failed" ? (
    <Badge tone="danger" title={job.last_error ?? undefined}>
      {S.adminJobsFailed}
    </Badge>
  ) : job.last_status === "succeeded" ? (
    <Badge tone="success">{S.adminJobsOk}</Badge>
  ) : (
    <Badge tone="neutral">{S.adminJobsNever}</Badge>
  );
  return (
    <li data-testid={`admin-job-${job.name}`}>
      <span>{S.adminJobsNames[job.name] ?? job.name}</span>
      {state}
      <span className="admin-account-muted">
        {S.adminJobsRuns(job.failures_24h, job.runs_24h)}
        {job.last_finished_at &&
          ` · ${S.adminJobsLast(when(job.last_finished_at))}`}
      </span>
      {job.last_status === "failed" && job.last_error && (
        <span className="admin-account-muted" dir="ltr">
          {job.last_error}
        </span>
      )}
    </li>
  );
}
