/**
 * What the four observability pages share: the gate and the frame.
 *
 * `useAdminShell` is the read-only twin of the guard in `AdminPage.tsx`.
 * In the demo (`?demo`) a page opens only if it says it has fixtures
 * (`{ demo: true }`: accounts, services, import); every other page says it
 * shows live data only and reads and writes nothing. It used to open them
 * all as admin, so the demo reached live admin calls (owner console review,
 * 2026-10-13, finding 15). Nothing is said
 * until it is known: a "forbidden" that flips to a table a moment later
 * reads as the page changing its mind about who you are, so the page holds
 * one sentence until `is_platform_admin()` answers. The hiding is a
 * courtesy; the database is the gate, as every RPC checks on its own.
 *
 * `AdminTabs` is the strip under each page head: the operator's
 * screens, the home first, as `NavLink`s so the address bar and the highlight agree. One
 * rail entry, `/admin`, and its subsections inside — the rail is the
 * product's map, and the admin area is one room in it.
 */
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useSession } from "../session";
import { useIsPlatformAdmin } from "../adminAccess";
import { useImpersonation } from "../impersonation";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Loading, LoadError } from "../pageStates/PageStates";
import { AdminCommandPalette } from "./AdminCommandPalette";
// Every admin page renders through this shell, so the admin styles travel with
// it. They lived only in AdminPage, so a sub-page opened directly (or
// refreshed) painted unstyled until /admin itself had been visited
// (2026-10-06, /admin/services).
import "../pages.css";
import "./admin.css";

export function useAdminShell(options?: { demo?: boolean }): {
  admin: boolean;
  shell: (body: ReactNode) => ReactNode;
} {
  const S = useStrings();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  const { session, loading } = useSession();
  const { isImpersonating } = useImpersonation();
  const access = useIsPlatformAdmin(demo ? null : session);
  const admin =
    demo || (!isImpersonating && !!(session && access.data === true));
  const shell = (body: ReactNode) => <div className="db-page">{body}</div>;
  if (demo && !options?.demo)
    return {
      admin: false,
      shell: () =>
        shell(
          <div className="db-hero">
            <Badge tone="neutral">{`${S.adminEyebrow} · ${S.dashDemoTag}`}</Badge>
            <h1>{S.adminTitle}</h1>
            <Card>
              <p data-testid="admin-no-demo">{S.adminNoDemo}</p>
              <Link to="/admin/workspaces?demo=1">{S.adminNoDemoLink}</Link>
            </Card>
          </div>,
        ),
    };
  if (!demo) {
    if (loading || (session && access.isPending))
      return {
        admin: false,
        shell: () => shell(<Loading S={S} label={S.pageOpening} shape="ops" />),
      };
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
  }
  return { admin: true, shell };
}

const TABS = [
  { to: "/admin", key: "adminTabHome" },
  { to: "/admin/workspaces", key: "adminTabWorkspaces" },
  { to: "/admin/users", key: "adminTabUsers" },
  { to: "/admin/channels", key: "adminTabChannels" },
  { to: "/admin/compare", key: "adminTabCompare" },
  { to: "/admin/system", key: "adminTabSystem" },
] as const;

/** The pages behind «النظام» (`AdminSystemPage.tsx`): each keeps its own
 *  address, and the strip lights «النظام» on any of them. */
export const SYSTEM_PATHS = [
  "/admin/services",
  "/admin/ops",
  "/admin/plans",
  "/admin/import",
  "/admin/audit",
] as const;
const inSystem = (path: string) =>
  path === "/admin/system" ||
  (SYSTEM_PATHS as readonly string[]).includes(path);

export function AdminTabs() {
  const S = useStrings();
  const { pathname } = useLocation();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  return (
    <div className="admin-tabs-row">
      <nav className="admin-tabs" aria-label={S.adminTabsLabel}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={demo ? `${t.to}?demo=1` : t.to}
            end
            className={({ isActive }: { isActive: boolean }) =>
              `admin-tab${
                isActive || (t.to === "/admin/system" && inSystem(pathname))
                  ? " admin-tab-active"
                  : ""
              }`
            }
            // `end` so /admin/users does not light /admin too; /admin itself
            // has no deeper route, so its tab still matches alone.
          >
            {S[t.key]}
          </NavLink>
        ))}
      </nav>
      {/* Live data only: the demo has no server for the lists. */}
      {!demo && <AdminCommandPalette />}
    </div>
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
  const { pathname } = useLocation();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  return (
    <header className="db-hero">
      <Badge tone="neutral">
        {demo ? `${S.adminEyebrow} · ${S.dashDemoTag}` : S.adminEyebrow}
      </Badge>
      {(SYSTEM_PATHS as readonly string[]).includes(pathname) && (
        <Link
          className="admin-system-back"
          to={demo ? "/admin/system?demo=1" : "/admin/system"}
        >
          {S.adminSystemBack}
        </Link>
      )}
      <h1>{title}</h1>
      <p>{lead}</p>
      <AdminTabs />
    </header>
  );
}
