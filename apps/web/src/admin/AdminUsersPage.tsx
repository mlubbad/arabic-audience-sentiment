/**
 * Every signed-up user: the email they came with, when they arrived, when
 * they were last here, and how many workspaces they stand in. One read, no
 * levers — phase one is eyes only; suspension and role changes arrive in
 * phase four, each with its own RPC and its own guard.
 */
import type { ReactNode } from "react";
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
import { readAdminUsers } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";

const NONE = "—";

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? NONE;

export function AdminUsersPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const list = useQuery({
    queryKey: ["admin", "users"],
    queryFn: readAdminUsers,
    enabled: admin,
  });

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
              </TableRow>
            </TableHead>
            <TableBody>
              {list.data.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </TableBody>
          </Table>
        </div>
        <Card className="admin-note">
          <p>{S.adminUsersPiiNote}</p>
        </Card>
      </section>
    );

  return shell(
    <>
      <AdminPageHead title={S.adminUsersTitle} lead={S.adminUsersLead} />
      {body}
    </>,
  );
}

function UserRow({ user }: { user: AdminUser }) {
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
    </TableRow>
  );
}
