/**
 * The owner console's «النظام» room: what runs the platform itself and is not
 * needed every day, one page instead of five tabs. Each card leads to its own
 * page, which keeps its address (`/admin/services`, `/admin/plans`, …), so a
 * link or bookmark from before still opens it; the tab strip shows «النظام»
 * as the current room on any of them (`SYSTEM_PATHS` in `AdminShell.tsx`).
 *
 * Two cards read live: the services' health as counts, and the last entries
 * of the audit trail, each through the read its own page uses. A read that
 * fails says so on its card and leaves the others.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { readAdminAudit, readAdminServicesHealth } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { BackgroundJobsCard } from "./BackgroundJobsCard";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function AdminSystemPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const services = useQuery({
    queryKey: ["admin", "services", "system"],
    queryFn: () => readAdminServicesHealth(),
    enabled: admin,
  });
  const audit = useQuery({
    queryKey: ["admin", "audit", 100],
    queryFn: () => readAdminAudit(100),
    enabled: admin,
  });

  let servicesLine: ReactNode = null;
  if (services.isError)
    servicesLine = <p className="admin-account-muted">{S.adminSystemUnread}</p>;
  else if (services.data) {
    const s = services.data.summary;
    servicesLine = (
      <p className="admin-system-chips" data-testid="admin-system-services">
        <Badge tone="success">{S.adminSystemHealthy(s.healthy)}</Badge>
        {s.degraded > 0 && (
          <Badge tone="warning">{S.adminSystemDegraded(s.degraded)}</Badge>
        )}
        {s.down > 0 && <Badge tone="danger">{S.adminSystemDown(s.down)}</Badge>}
      </p>
    );
  }

  let auditList: ReactNode = null;
  if (audit.isError)
    auditList = <p className="admin-account-muted">{S.adminSystemUnread}</p>;
  else if (audit.data)
    auditList =
      audit.data.length === 0 ? (
        <p className="admin-account-muted">{S.adminHomeActivityEmpty}</p>
      ) : (
        <ol className="admin-account-history" data-testid="admin-system-audit">
          {audit.data.slice(0, 5).map((e, i) => (
            <li key={`${e.created_at}-${i}`}>
              <time dateTime={e.created_at}>{when(e.created_at)}</time>
              <span>{S.adminAccountActions[e.action] ?? e.action}</span>
            </li>
          ))}
        </ol>
      );

  return shell(
    <>
      <AdminPageHead title={S.adminSystemTitle} lead={S.adminSystemLead} />
      {admin && (
        <div className="admin-home-grid" data-testid="admin-system">
          <BackgroundJobsCard enabled={admin} />
          <Room
            to="/admin/services"
            title={S.adminTabServices}
            lead={S.adminServicesLead}
          >
            {servicesLine}
          </Room>
          <Room to="/admin/ops" title={S.adminTabOps} lead={S.adminOpsLead} />
          <Room
            to="/admin/plans"
            title={S.adminTabPlans}
            lead={S.adminPlansLead}
          />
          <Room
            to="/admin/import"
            title={S.adminTabImport}
            lead={S.adminImportLead}
          />
          <Room
            to="/admin/audit"
            title={S.adminTabAudit}
            lead={S.adminAuditLead}
          >
            {auditList}
          </Room>
        </div>
      )}
    </>,
  );
}

function Room({
  to,
  title,
  lead,
  children,
}: {
  to: string;
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  const S = useStrings();
  return (
    <Card className="admin-home-card">
      <h2>{title}</h2>
      <p className="admin-account-muted">{lead}</p>
      {children}
      <Link className="admin-console-enter" to={to}>
        {S.adminSystemOpen(title)}
      </Link>
    </Card>
  );
}
