/**
 * What the four observability pages share: the gate and the frame.
 *
 * `useAdminShell` is the read-only twin of the guard in `AdminPage.tsx`,
 * without the demo door — these pages read live data only. Nothing is said
 * until it is known: a "forbidden" that flips to a table a moment later
 * reads as the page changing its mind about who you are, so the page holds
 * one sentence until `is_platform_admin()` answers. The hiding is a
 * courtesy; the database is the gate, as every RPC checks on its own.
 *
 * `AdminTabs` is the strip under each page head: the operator's five
 * screens, as `NavLink`s so the address bar and the highlight agree. One
 * rail entry, `/admin`, and its subsections inside — the rail is the
 * product's map, and the admin area is one room in it.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useSession } from "../session";
import { useIsPlatformAdmin } from "../adminAccess";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Loading, LoadError } from "../pageStates/PageStates";

export function useAdminShell(): {
  admin: boolean;
  shell: (body: ReactNode) => ReactNode;
} {
  const S = useStrings();
  const { session, loading } = useSession();
  const access = useIsPlatformAdmin(session);
  const admin = !!(session && access.data === true);
  const shell = (body: ReactNode) => (
    <div className="db-page">
      {body}
    </div>
  );
  if (loading || (session && access.isPending))
    return { admin: false, shell: () => shell(<Loading S={S} label={S.pageOpening} shape="ops" />) };
  if (access.isError)
    return {
      admin: false,
      shell: () =>
        shell(
          <LoadError
            S={S}
            message={S.serviceUnreachable}
            failure={failureCode("read", access.error)}
            onRetry={() => void access.refetch()}
          />,
        ),
    };
  // Signed out, unconfigured, or signed in and not an admin: one sentence.
  if (!admin)
    return {
      admin: false,
      shell: () =>
        shell(
          <div className="db-hero">
            <Badge tone="neutral">{S.adminEyebrow}</Badge>
            <h1>{S.adminTitle}</h1>
            <Card className="db-error">
              <p role="alert" data-testid="admin-forbidden">
                {S.adminForbidden}
              </p>
            </Card>
          </div>,
        ),
    };
  return { admin: true, shell };
}

const TABS = [
  { to: "/admin", key: "adminTabWorkspaces" },
  { to: "/admin/users", key: "adminTabUsers" },
  { to: "/admin/channels", key: "adminTabChannels" },
  { to: "/admin/ops", key: "adminTabOps" },
  { to: "/admin/audit", key: "adminTabAudit" },
] as const;

export function AdminTabs() {
  const S = useStrings();
  return (
    <nav className="admin-tabs" aria-label={S.adminTabsLabel}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }: { isActive: boolean }) =>
            `admin-tab${isActive ? " admin-tab-active" : ""}`
          }
          // `end` so /admin/users does not light /admin too; /admin itself
          // has no deeper route, so its tab still matches alone.
        >
          {S[t.key]}
        </NavLink>
      ))}
    </nav>
  );
}

/** The head every observability page carries: eyebrow, h1, lead, tabs. */
export function AdminPageHead({
  title,
  lead,
}: {
  title: string;
  lead: string;
}) {
  const S = useStrings();
  return (
    <header className="db-hero">
      <Badge tone="neutral">{S.adminEyebrow}</Badge>
      <h1>{title}</h1>
      <p>{lead}</p>
      <AdminTabs />
    </header>
  );
}
