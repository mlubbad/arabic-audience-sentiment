/**
 * The audit trail, newest first: what was done, by whom, to what, and when.
 * The trail is append-only at the trigger level (`audit_events` refuses
 * update and delete), so this page is a window, never an editor.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStrings } from "../strings";
import { auditActionLabel } from "../adminWords";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { AUDIT_LIMITS, readAdminAudit, type AuditLimit } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";

export function AdminAuditPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const [limit, setLimit] = useState<AuditLimit>(100);
  const list = useQuery({
    queryKey: ["admin", "audit", limit],
    queryFn: () => readAdminAudit(limit),
    enabled: admin,
  });

  let body: ReactNode;
  if (!admin) body = null;
  else if (list.isPending)
    body = <Loading S={S} label={S.adminAuditLoading} shape="ops" />;
  else if (list.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", list.error)}
        onRetry={() => void list.refetch()}
      />
    );
  else if (list.data.length === 0)
    body = (
      <ChartEmpty testId="admin-audit-empty">{S.adminAuditEmpty}</ChartEmpty>
    );
  else
    body = (
      <section className="db-section" aria-labelledby="admin-audit-heading">
        <header className="admin-audit-head">
          <h2 id="admin-audit-heading">{S.adminAuditHeading}</h2>
          <div
            className="admin-audit-limits"
            role="group"
            aria-label={S.adminAuditLimitLabel}
          >
            {AUDIT_LIMITS.map((n) => (
              <button
                key={n}
                type="button"
                className={`admin-tab${limit === n ? " admin-tab-active" : ""}`}
                onClick={() => setLimit(n)}
                aria-pressed={limit === n}
              >
                {n}
              </button>
            ))}
          </div>
        </header>
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-audit">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.adminAuditWhen}</TableHeaderCell>
                <TableHeaderCell>{S.adminAuditWorkspace}</TableHeaderCell>
                <TableHeaderCell>{S.adminAuditActor}</TableHeaderCell>
                <TableHeaderCell>{S.adminAuditAction}</TableHeaderCell>
                <TableHeaderCell>{S.adminAuditTarget}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    {e.created_at.slice(0, 16).replace("T", " ")}
                  </TableCell>
                  <TableCell>{e.workspace_name}</TableCell>
                  <TableCell>{e.actor_email ?? "—"}</TableCell>
                  <TableCell>
                    <span className="admin-audit-action">
                      {auditActionLabel(e.action, S)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {e.target_type}
                    {e.target_id ? ` · ${e.target_id}` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    );

  return shell(
    <>
      <AdminPageHead title={S.adminAuditTitle} lead={S.adminAuditLead} />
      {body}
    </>,
  );
}
