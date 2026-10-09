/**
 * Every signed-up user: the email they came with, when they arrived, when
 * they were last here, and how many workspaces they stand in. "Manage" opens
 * the person's account file (`AccountFile.tsx`): their details, password
 * help, roles, plans and history, each change with its own RPC and guard.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminUser } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { Card } from "../ui/Card";
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
import { readAdminUsers } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { DEMO_USERS, DEMO_OWNER_ID } from "./adminDemo";
import { AccountFile } from "./AccountFile";

const NONE = "—";

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? NONE;

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
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const list = useQuery({
    queryKey: ["admin", "users", demo ? "demo" : "live"],
    queryFn: () => (demo ? Promise.resolve(DEMO_USERS) : readAdminUsers()),
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
  else
    body = (
      <section className="db-section" aria-labelledby="admin-users-heading">
        <header>
          <h2 id="admin-users-heading">{S.adminUsersHeading}</h2>
        </header>
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-users">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.adminUsersEmail}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersJoined}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersLastSeen}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersWorkspaces}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersOwned}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersActions}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.data.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isCurrent={currentUserId === u.id}
                  onImpersonate={startImpersonation}
                  onManage={demo ? undefined : setManaging}
                  disabled={impersonateLoading}
                />
              ))}
            </TableBody>
          </Table>
        </div>
        <Card className="admin-note">
          <p>{S.adminUsersPiiNote}</p>
        </Card>
        <AccountFile user={managing} onClose={() => setManaging(null)} />
      </section>
    );

  return shell(
    <>
      <AdminPageHead title={S.adminUsersTitle} lead={S.adminUsersLead} />
      {body}
    </>,
  );
}

function UserRow({
  user,
  isCurrent,
  onImpersonate,
  onManage,
  disabled,
}: {
  user: AdminUser;
  isCurrent: boolean;
  onImpersonate: (user: AdminUser) => void;
  /** Absent on the demo, which has no server to read a file from. */
  onManage?: (user: AdminUser) => void;
  disabled: boolean;
}) {
  const S = useStrings();
  return (
    <TableRow>
      <TableCell data-testid="admin-user-email">
        {user.email ?? S.adminUsersNoEmail}
      </TableCell>
      <TableCell>{day(user.created_at)}</TableCell>
      <TableCell>{day(user.last_sign_in_at)}</TableCell>
      <TableCell>{user.workspace_count}</TableCell>
      <TableCell>{user.owner_count}</TableCell>
      <TableCell className="admin-user-actions">
        {onManage && (
          <Button
            type="button"
            size="sm"
            onClick={() => onManage(user)}
            data-testid={`admin-manage-${user.id}`}
            aria-label={`${S.adminUserManage} ${user.email ?? user.id}`}
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
            onClick={() => onImpersonate(user)}
            data-testid={`admin-impersonate-${user.id}`}
            aria-label={`${S.adminUserImpersonate} ${user.email ?? user.id}`}
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
