/**
 * The account file: one person, opened from the admin users page as a side
 * panel (owner request, 2026-10-09).
 *
 * Five parts, each its own server call and each in the audit trail:
 * - the details the owner keeps about them (`admin_update_user_profile`);
 * - password help, a reset link to their own inbox — no one sees or sets a
 *   password here (`sendPasswordReset`);
 * - their seat in every workspace, analyst or viewer
 *   (`update_workspace_account_role`; the owner's seat is not changed here);
 * - the plan of every workspace they created, the same rows and levers as
 *   the workspaces page (`LiveWorkspaces`);
 * - their history: the trail rows that name them, newest first.
 *
 * Suspension, a link the owner hands over, and email changes need the auth
 * admin API, which a browser never holds; they arrive with the `admin-users`
 * function.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser, AdminUserDetail } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { useAdminPlanCatalogue } from "../planCatalogue";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { LoadError, Loading } from "../pageStates/PageStates";
import { LiveWorkspaces, readWorkspaces } from "./AdminPage";
import {
  readAdminUserDetail,
  saveAdminUserProfile,
  sendPasswordReset,
  setAdminMemberRole,
  type AdminProfileInput,
} from "./adminRead";

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "—";

export function AccountFile({
  user,
  onClose,
}: {
  /** The row the file was opened from; null when it is closed. */
  user: AdminUser | null;
  onClose: () => void;
}) {
  const S = useStrings();
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        variant="sheet"
        closeLabel={S.adminAccountClose}
        closeTestId="admin-account-close"
        className="admin-account-sheet"
        aria-describedby={undefined}
        data-testid="admin-account-file"
      >
        <DialogTitle>{S.adminAccountTitle}</DialogTitle>
        {user && <AccountBody user={user} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountBody({ user }: { user: AdminUser }) {
  const S = useStrings();
  const detail = useQuery({
    queryKey: ["admin", "user", user.id],
    queryFn: () => readAdminUserDetail(user.id),
  });
  if (detail.isPending)
    return <Loading S={S} label={S.adminAccountLoading} shape="ops" />;
  if (detail.isError)
    return (
      <LoadError
        S={S}
        message={S.adminAccountLoadFailed}
        failure={failureCode("read", detail.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  const d = detail.data;
  const suspended = !!d.banned_until && Date.parse(d.banned_until) > Date.now();
  return (
    <div className="admin-account">
      <header className="admin-account-head">
        <strong dir="auto">{d.profile.display_name ?? d.email ?? d.id}</strong>
        {d.profile.display_name && d.email && (
          <small dir="ltr">{d.email}</small>
        )}
        <div className="admin-account-chips">
          <Badge tone={d.email_confirmed_at ? "success" : "warning"}>
            {d.email_confirmed_at
              ? S.adminAccountEmailConfirmed
              : S.adminAccountEmailUnconfirmed}
          </Badge>
          {suspended && <Badge tone="danger">{S.adminAccountSuspended}</Badge>}
        </div>
        <dl className="admin-account-facts">
          <dt>{S.adminUsersJoined}</dt>
          <dd>{day(d.created_at)}</dd>
          <dt>{S.adminUsersLastSeen}</dt>
          <dd>{day(d.last_sign_in_at)}</dd>
        </dl>
      </header>
      <ProfileForm detail={d} />
      <PasswordHelp detail={d} />
      <Memberships detail={d} />
      <Plans userId={d.id} />
      <History detail={d} />
    </div>
  );
}

function ProfileForm({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AdminProfileInput>({
    display_name: detail.profile.display_name ?? "",
    organization: detail.profile.organization ?? "",
    phone: detail.profile.phone ?? "",
    admin_note: detail.profile.admin_note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const field =
    (k: keyof AdminProfileInput) => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await saveAdminUserProfile(detail.id, form);
      setNote({ ok: true, text: S.adminAccountSaved });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "user", detail.id],
      });
    } catch (err) {
      const message = (err as { message?: string }).message;
      setNote({
        ok: false,
        text:
          message === "profile_too_long"
            ? S.adminAccountTooLong
            : S.adminAccountSaveFailed,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="admin-account-section"
      onSubmit={submit}
      data-testid="admin-account-profile"
    >
      <h3>{S.adminAccountDetails}</h3>
      <div className="admin-account-grid">
        <div className="ui-field">
          <label htmlFor="acct-name">{S.adminAccountName}</label>
          <Input
            id="acct-name"
            maxLength={120}
            value={form.display_name}
            onChange={field("display_name")}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="acct-org">{S.adminAccountOrg}</label>
          <Input
            id="acct-org"
            maxLength={120}
            value={form.organization}
            onChange={field("organization")}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="acct-phone">{S.adminAccountPhone}</label>
          <Input
            id="acct-phone"
            dir="ltr"
            type="tel"
            maxLength={40}
            value={form.phone}
            onChange={field("phone")}
          />
        </div>
      </div>
      <div className="ui-field">
        <label htmlFor="acct-note">{S.adminAccountNote}</label>
        <Textarea
          id="acct-note"
          rows={2}
          maxLength={2000}
          value={form.admin_note}
          onChange={field("admin_note")}
        />
      </div>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={note.ok ? "admin-account-ok" : "admin-account-error"}
        >
          {note.text}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy}>
        {S.adminAccountSave}
      </Button>
    </form>
  );
}

function PasswordHelp({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const email = detail.email;

  async function send() {
    if (!email) return;
    setBusy(true);
    setNote(null);
    try {
      await sendPasswordReset(detail.id, email);
      setNote({ ok: true, text: S.adminAccountResetSent(email) });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "user", detail.id],
      });
    } catch {
      setNote({ ok: false, text: S.adminAccountResetFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountPassword}</h3>
      <p className="admin-account-callout">{S.adminAccountPasswordNote}</p>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={note.ok ? "admin-account-ok" : "admin-account-error"}
        >
          {note.text}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !email}
        onClick={() => void send()}
        data-testid="admin-account-send-reset"
      >
        {S.adminAccountSendReset}
      </Button>
    </section>
  );
}

function Memberships({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const roleLabel: Record<string, string> = {
    workspace_owner: S.shareWorkspaceRoleOwner,
    analyst: S.shareWorkspaceRoleAnalystBadge,
    viewer: S.shareWorkspaceRoleViewerBadge,
  };

  async function change(workspaceId: string, role: string) {
    if (role !== "analyst" && role !== "viewer") return;
    setFailed(false);
    try {
      await setAdminMemberRole(workspaceId, detail.id, role);
      await queryClient.invalidateQueries({
        queryKey: ["admin", "user", detail.id],
      });
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountWorkspaces}</h3>
      {detail.memberships.length === 0 ? (
        <p className="admin-account-muted">{S.adminAccountWorkspacesNone}</p>
      ) : (
        <ul className="admin-account-list" data-testid="admin-account-seats">
          {detail.memberships.map((m) => (
            <li key={m.workspace_id}>
              <span dir="auto">
                {m.workspace_name}
                {m.created_by_user && (
                  <small className="admin-account-muted">
                    {" · "}
                    {S.adminAccountCreatedHere}
                  </small>
                )}
              </span>
              {m.role === "workspace_owner" ? (
                <Badge tone="neutral">{roleLabel[m.role]}</Badge>
              ) : (
                <Select
                  value={m.role}
                  onValueChange={(role) => void change(m.workspace_id, role)}
                >
                  <SelectTrigger
                    aria-label={`${S.shareWorkspaceRoleLabel} · ${m.workspace_name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analyst">{roleLabel.analyst}</SelectItem>
                    <SelectItem value="viewer">{roleLabel.viewer}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="admin-account-error">
          {S.adminAccountRoleFailed}
        </p>
      )}
    </section>
  );
}

function Plans({ userId }: { userId: string }) {
  const S = useStrings();
  // The workspaces page's own read and key: a plan changed here shows there,
  // and the other way round.
  const list = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: readWorkspaces,
  });
  const catalogue = useAdminPlanCatalogue(true);
  const owned = (list.data ?? []).filter((w) => w.created_by === userId);
  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountPlans}</h3>
      <p className="admin-account-muted">{S.adminAccountPlansLead}</p>
      {list.isPending ? (
        <Loading S={S} label={S.adminLoading} shape="ops" />
      ) : list.isError ? (
        <LoadError
          S={S}
          failure={failureCode("read", list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : owned.length === 0 ? (
        <p className="admin-account-muted">{S.adminAccountPlansNone}</p>
      ) : (
        <LiveWorkspaces rows={owned} catalogue={catalogue.data ?? []} stacked />
      )}
    </section>
  );
}

function History({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountHistory}</h3>
      {detail.history.length === 0 ? (
        <p className="admin-account-muted">{S.adminAccountHistoryEmpty}</p>
      ) : (
        <ol
          className="admin-account-history"
          data-testid="admin-account-history"
        >
          {detail.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <time dateTime={h.at}>{h.at.slice(0, 16).replace("T", " ")}</time>
              <span>
                {S.adminAccountActions[h.action] ?? h.action}
                {h.workspace_name && (
                  <span dir="auto"> · {h.workspace_name}</span>
                )}
                <small className="admin-account-muted">
                  {" "}
                  {h.by_self
                    ? S.adminAccountHistorySelf
                    : h.actor_email
                      ? S.adminAccountHistoryBy(h.actor_email)
                      : ""}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
