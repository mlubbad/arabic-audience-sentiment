/**
 * The owner console's accounts page (phase 2, step 3): every account with
 * the workspaces, channels and plan it holds, `admin_accounts()`.
 *
 * Customers, test accounts (marked in the account file) and platform admins
 * each have their own section, with a search over email, name and
 * organisation. "Manage" opens the account file (`AccountFile.tsx`): details,
 * password help, email and suspension, roles, plans and history, each change
 * with its own RPC and guard. "Log in as" views the platform as that person.
 *
 * `?demo=1` keeps its fixture of users (the browser suite drives the
 * impersonation escape hatch on it); with no server, it has no account file.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminAccount } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { Button } from "../ui/Button";
import { useSession } from "../session";
import { useImpersonation } from "../impersonation";
import { readAdminAccounts } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { DEMO_USERS, DEMO_OWNER_ID } from "./adminDemo";
import { AccountFile } from "./AccountFile";
import { fold } from "./AdminCommandPalette";

const NONE = "—";
const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? NONE;

export type AccountSegment = "all" | "customers" | "test" | "admins";

/** Which section an account belongs to. An admin is never a customer, and a
 *  test account is never one either, whoever made it. */
export function inSegment(a: AdminAccount, segment: AccountSegment): boolean {
  if (segment === "admins") return a.is_admin;
  if (segment === "test") return a.is_test;
  if (segment === "customers") return !a.is_admin && !a.is_test;
  return true;
}

export function matchesAccount(a: AdminAccount, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [a.email, a.display_name, a.organization].filter(Boolean).join(" "),
  );
  return words.every((w) => hay.includes(w));
}

/** The demo's fixture users in the accounts page's shape. */
const DEMO_ACCOUNTS: AdminAccount[] = DEMO_USERS.map((u) => ({
  id: u.id,
  email: u.email,
  display_name: null,
  organization: null,
  created_at: u.created_at,
  last_sign_in_at: u.last_sign_in_at,
  suspended: false,
  is_admin: u.id === DEMO_OWNER_ID,
  is_test: false,
  workspaces: u.workspace_count,
  owned: u.owner_count,
  channels: 0,
  plan_key: null,
  plan_status: null,
  period_end: null,
  provider: null,
}));

const SEGMENTS: { key: AccountSegment; label: keyof SegmentLabels }[] = [
  { key: "all", label: "adminAccountsAll" },
  { key: "customers", label: "adminAccountsCustomers" },
  { key: "test", label: "adminAccountsTest" },
  { key: "admins", label: "adminAccountsAdmins" },
];
type SegmentLabels = {
  adminAccountsAll: string;
  adminAccountsCustomers: string;
  adminAccountsTest: string;
  adminAccountsAdmins: string;
};

export function AdminUsersPage() {
  const S = useStrings();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  const { admin, shell } = useAdminShell();
  const { session } = useSession();
  const currentUserId = demo ? DEMO_OWNER_ID : session?.user.id;
  const { startImpersonation, loading: impersonateLoading } =
    useImpersonation();
  const [managing, setManaging] = useState<AdminAccount | null>(null);
  const [segment, setSegment] = useState<AccountSegment>("all");
  const [query, setQuery] = useState("");
  const list = useQuery({
    queryKey: ["admin", "accounts", demo ? "demo" : "live"],
    queryFn: () =>
      demo ? Promise.resolve(DEMO_ACCOUNTS) : readAdminAccounts(),
    enabled: admin,
  });

  // `?u=<id>`: the search box's way to one person's file.
  const wanted =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("u")
      : null;
  useEffect(() => {
    if (!wanted || demo || !list.data) return;
    const found = list.data.find((u) => u.id === wanted);
    if (found) setManaging(found);
  }, [wanted, demo, list.data]);

  let body: ReactNode;
  if (!admin)
    body = null; // the shell is already showing the gate's sentence
  else if (list.isPending)
    body = <Loading S={S} label={S.adminUsersLoading} shape="ops" />;
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
      <ChartEmpty testId="admin-users-empty">{S.adminUsersEmpty}</ChartEmpty>
    );
  else {
    const searched = list.data.filter((a) => matchesAccount(a, query));
    const shown = searched.filter((a) => inSegment(a, segment));
    body = (
      <section
        className="db-section admin-console"
        aria-labelledby="admin-users-heading"
      >
        <header>
          <h2 id="admin-users-heading">{S.adminUsersHeading}</h2>
        </header>
        <div
          className="admin-console-states"
          role="group"
          aria-label={S.adminUsersHeading}
        >
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={segment === s.key}
              onClick={() => setSegment(s.key)}
              data-testid={`admin-accounts-${s.key}`}
            >
              {S[s.label]}{" "}
              <span className="admin-home-num">
                {searched.filter((a) => inSegment(a, s.key)).length}
              </span>
            </button>
          ))}
        </div>
        <div className="admin-console-bar">
          <Input
            type="search"
            aria-label={S.adminAccountsSearch}
            placeholder={S.adminAccountsSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {shown.length === 0 ? (
          <ChartEmpty testId="admin-accounts-empty">
            {S.adminAccountsEmpty}
          </ChartEmpty>
        ) : (
          <div className="table-wrap db-admin-wrap">
            <Table data-testid="admin-users">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{S.adminAccountsAccount}</TableHeaderCell>
                  <TableHeaderCell>{S.adminAccountsPlan}</TableHeaderCell>
                  <TableHeaderCell>{S.adminAccountsHoldings}</TableHeaderCell>
                  <TableHeaderCell>{S.adminUsersJoined}</TableHeaderCell>
                  <TableHeaderCell>{S.adminUsersLastSeen}</TableHeaderCell>
                  <TableHeaderCell>{S.adminUsersActions}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((u) => (
                  <AccountRow
                    key={u.id}
                    account={u}
                    isCurrent={currentUserId === u.id}
                    onImpersonate={startImpersonation}
                    onManage={demo ? undefined : setManaging}
                    disabled={impersonateLoading}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Card className="admin-note">
          <p>{S.adminUsersPiiNote}</p>
        </Card>
        <AccountFile user={managing} onClose={() => setManaging(null)} />
      </section>
    );
  }

  return shell(
    <>
      <AdminPageHead title={S.adminUsersTitle} lead={S.adminUsersLead} />
      {body}
    </>,
  );
}

function AccountRow({
  account: u,
  isCurrent,
  onImpersonate,
  onManage,
  disabled,
}: {
  account: AdminAccount;
  isCurrent: boolean;
  onImpersonate: (user: { id: string; email: string | null }) => void;
  /** Absent on the demo, which has no server to read a file from. */
  onManage?: (account: AdminAccount) => void;
  disabled: boolean;
}) {
  const S = useStrings();
  return (
    <TableRow data-testid={`admin-account-row-${u.id}`}>
      <TableCell>
        {u.display_name && (
          <span className="admin-channel-name" dir="auto">
            {u.display_name}
          </span>
        )}
        <span
          className={u.display_name ? "admin-channel-sub" : undefined}
          data-testid="admin-user-email"
          dir="ltr"
        >
          {u.email ?? S.adminUsersNoEmail}
        </span>
        <span className="admin-account-chips">
          {u.is_admin && (
            <Badge tone="neutral">{S.adminAccountsTagAdmin}</Badge>
          )}
          {u.is_test && <Badge tone="neutral">{S.adminAccountsTagTest}</Badge>}
          {u.suspended && (
            <Badge tone="danger">{S.adminAccountSuspended}</Badge>
          )}
        </span>
      </TableCell>
      <TableCell>
        {u.plan_key ?? S.adminAccountsNoPlan}
        {u.period_end && (
          <span className="admin-channel-sub">{day(u.period_end)}</span>
        )}
      </TableCell>
      <TableCell>
        {u.workspaces} · {u.channels}
      </TableCell>
      <TableCell>{day(u.created_at)}</TableCell>
      <TableCell>{day(u.last_sign_in_at)}</TableCell>
      <TableCell className="admin-user-actions">
        {onManage && (
          <Button
            type="button"
            size="sm"
            onClick={() => onManage(u)}
            data-testid={`admin-manage-${u.id}`}
            aria-label={`${S.adminUserManage} ${u.email ?? u.id}`}
          >
            {S.adminUserManage}
          </Button>
        )}
        {isCurrent ? (
          <span className="admin-user-current" data-testid="admin-user-current">
            {S.adminUserCurrent}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="admin-impersonate-btn"
            disabled={disabled}
            onClick={() => onImpersonate({ id: u.id, email: u.email })}
            data-testid={`admin-impersonate-${u.id}`}
            aria-label={`${S.adminUserImpersonate} ${u.email ?? u.id}`}
          >
            <span aria-hidden="true" className="admin-impersonate-icon">
              🎭
            </span>
            <span>{S.adminUserImpersonate}</span>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
