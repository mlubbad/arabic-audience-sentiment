/**
 * The operations overview: the numbers a problem announces itself through,
 * and the failed and partial runs of the last two weeks. This page is the
 * seed of roadmap phase two — when the health engine lands, these are the
 * signals it will watch; until then the operator reads them here, fresh
 * from `admin_ops()` on every visit.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { readAdminOps } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";

export function AdminOpsPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const ops = useQuery({
    queryKey: ["admin", "ops"],
    queryFn: readAdminOps,
    enabled: admin,
  });

  let body: ReactNode;
  if (!admin) body = null;
  else if (ops.isPending)
    body = <Loading S={S} label={S.adminOpsLoading} shape="ops" />;
  else if (ops.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", ops.error)}
        onRetry={() => void ops.refetch()}
      />
    );
  else
    body = (
      <>
        <section className="db-section" aria-labelledby="admin-ops-heading">
          <header>
            <h2 id="admin-ops-heading">{S.adminOpsHeading}</h2>
          </header>
          <div className="admin-metrics" data-testid="admin-ops-metrics">
            <Metric label={S.adminOpsWorkspaces} value={ops.data.workspaces} />
            <Metric label={S.adminOpsChannels} value={ops.data.channels} />
            <Metric label={S.adminOpsComments7d} value={ops.data.comments_7d} />
            <Metric label={S.adminOpsRuns7d} value={ops.data.sync_runs_7d} />
            <Metric
              label={S.adminOpsFailed7d}
              value={ops.data.sync_failed_7d}
              warn={ops.data.sync_failed_7d > 0}
            />
            {/* Partial runs apart from failed ones (review finding 9). */}
            <Metric
              label={S.adminOpsPartial7d}
              value={ops.data.sync_partial_7d ?? 0}
            />
            <Metric label={S.adminOpsJobsOpen} value={ops.data.jobs_open} />
            <WorkerCard
              fresh={ops.data.worker_fresh}
              lastSeen={ops.data.worker_last_seen}
            />
          </div>
        </section>
        <section
          className="db-section"
          aria-labelledby="admin-ops-failed-heading"
        >
          <header>
            <h2 id="admin-ops-failed-heading">{S.adminOpsFailedHeading}</h2>
            <p>{S.adminOpsFailedLead}</p>
          </header>
          {ops.data.failed_runs.length === 0 ? (
            <ChartEmpty testId="admin-ops-failed-empty">
              {S.adminOpsFailedEmpty}
            </ChartEmpty>
          ) : (
            <div className="table-wrap db-admin-wrap">
              <Table data-testid="admin-ops-failed">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{S.adminOpsFailedWhen}</TableHeaderCell>
                    <TableHeaderCell>
                      {S.adminOpsFailedWorkspace}
                    </TableHeaderCell>
                    <TableHeaderCell>{S.adminOpsFailedChannel}</TableHeaderCell>
                    <TableHeaderCell>{S.adminOpsFailedMode}</TableHeaderCell>
                    <TableHeaderCell>{S.adminOpsFailedStatus}</TableHeaderCell>
                    <TableHeaderCell>{S.adminOpsFailedError}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ops.data.failed_runs.map((r, i) => (
                    <TableRow
                      key={`${r.workspace_id}:${r.channel_id}:${r.started_at}:${i}`}
                    >
                      <TableCell>
                        {r.started_at.slice(0, 16).replace("T", " ")}
                      </TableCell>
                      <TableCell>{r.workspace_name}</TableCell>
                      <TableCell>
                        {r.handle ?? S.adminOpsFailedNoChannel}
                      </TableCell>
                      <TableCell>{r.mode}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell>{r.error_code ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </>
    );

  return shell(
    <>
      <AdminPageHead title={S.adminOpsTitle} lead={S.adminOpsLead} />
      {body}
    </>,
  );
}

function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className={`admin-metric${warn ? " admin-metric-warn" : ""}`}>
      {/* A figure wears the numeric face: brand.css's rule for every count. */}
      <span className="admin-metric-value ui-num">{value}</span>
      <span className="admin-metric-label">{label}</span>
    </div>
  );
}

function WorkerCard({
  fresh,
  lastSeen,
}: {
  fresh: boolean;
  lastSeen: string | null;
}) {
  const S = useStrings();
  return (
    <div className="admin-metric">
      <span className="admin-metric-value">
        <Badge tone={fresh ? "success" : "danger"}>
          {fresh ? S.adminOpsWorkerFresh : S.adminOpsWorkerStale}
        </Badge>
      </span>
      <span className="admin-metric-label">
        {S.adminOpsWorkerLabel}
        {lastSeen ? ` · ${lastSeen.slice(0, 16).replace("T", " ")}` : ""}
      </span>
    </div>
  );
}
