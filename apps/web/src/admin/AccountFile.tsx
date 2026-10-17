/**
 * The account file: one person, opened from the admin users page as a side
 * panel (owner request, 2026-10-09).
 *
 * Each part is its own server call, and each lands in the audit trail:
 * - the details the owner keeps about them (`admin_update_user_profile`);
 * - password help, a reset link to their own inbox (`sendPasswordReset`) or
 *   one the owner hands over (`admin-users`); no one sees or sets a password;
 * - their email, confirmed or changed by hand, and their account suspended
 *   or restored (`admin-users`: these need the auth admin API, which a
 *   browser never holds);
 * - their seat in every workspace, analyst or viewer
 *   (`update_workspace_account_role`; the owner's seat is not changed here);
 * - the plan of every workspace they created, the same rows and levers as
 *   the workspaces page (`LiveWorkspaces`);
 * - their history: the trail rows that name them, newest first.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUserDetail } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { auditActionLabel } from "../adminWords";
import { failureCode } from "../failure";
import { useAdminPlanCatalogue } from "../planCatalogue";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
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
  AdminUserActionError,
  adminUserAction,
  readAdminUserDetail,
  saveAdminUserProfile,
  sendPasswordReset,
  setAdminMemberRole,
  setUserTest,
  type AdminProfileInput,
  type AdminUserActionName,
} from "./adminRead";

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "—";

export function AccountFile({
  user,
  onClose,
}: {
  /** The row the file was opened from; null when it is closed. */
  user: { id: string } | null;
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

function AccountBody({ user }: { user: { id: string } }) {
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
      <TestMark detail={d} />
      <PasswordHelp detail={d} />
      <EmailSection detail={d} />
      <StatusSection detail={d} suspended={suspended} />
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

/** Set the account apart as a test account: the accounts page lists it
 *  under its own section, away from the customers. */
function TestMark({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function change(on: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await setUserTest(detail.id, on);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "user", detail.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] }),
      ]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-account-section" data-testid="admin-account-test">
      <Checkbox
        label={S.adminAccountTestLabel}
        checked={detail.is_test}
        disabled={busy}
        onCheckedChange={(on) => void change(on === true)}
      />
      {failed && (
        <p role="alert" className="admin-account-error">
          {S.adminAccountTestFailed}
        </p>
      )}
    </section>
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
      <HandedLink userId={detail.id} />
    </section>
  );
}

type Note = { ok: boolean; text: string } | null;

/** One `admin-users` action at a time for this person: busy while it runs,
 *  the sentence it ended with, and the file re-read so its badges follow. */
function useAccountAction(userId: string) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  async function run(
    action: AdminUserActionName,
    done: (result: { link?: string }) => string,
    email?: string,
  ): Promise<{ link?: string } | null> {
    setBusy(true);
    setNote(null);
    try {
      const result = await adminUserAction(action, userId, email);
      const text = done(result);
      setNote({
        ok: true,
        text: result.recorded ? text : `${text} ${S.adminAccountNotRecorded}`,
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "user", userId],
      });
      return result;
    } catch (error) {
      const code =
        error instanceof AdminUserActionError ? error.code : "unavailable";
      setNote({
        ok: false,
        text:
          S.adminAccountActionErrors[code] ??
          S.adminAccountActionErrors.unavailable!,
      });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, note, setNote, run };
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p
      role={note.ok ? "status" : "alert"}
      className={note.ok ? "admin-account-ok" : "admin-account-error"}
    >
      {note.text}
    </p>
  );
}

/** A link the owner hands over: shown once, with a copy button and the
 *  warning that it opens the account to whoever holds it. */
function HandedLink({ userId }: { userId: string }) {
  const S = useStrings();
  const { busy, note, setNote, run } = useAccountAction(userId);
  const [link, setLink] = useState<string | null>(null);
  async function make() {
    setLink(null);
    const result = await run("recovery_link", () => S.adminAccountLinkWarning);
    if (result?.link) setLink(result.link);
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNote({ ok: true, text: S.adminAccountCopied });
    } catch {
      /* The field is selectable; copying by hand still works. */
    }
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void make()}
        data-testid="admin-account-make-link"
      >
        {S.adminAccountMakeLink}
      </Button>
      {link && (
        <div className="ui-field">
          <label htmlFor="acct-link">{S.adminAccountLinkLabel}</label>
          <Input
            id="acct-link"
            dir="ltr"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copy()}
          >
            {S.adminAccountCopy}
          </Button>
        </div>
      )}
      <NoteLine note={note} />
    </>
  );
}

function EmailSection({ detail }: { detail: AdminUserDetail }) {
  const S = useStrings();
  const confirm = useAccountAction(detail.id);
  const change = useAccountAction(detail.id);
  const [email, setEmail] = useState("");
  const [again, setAgain] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (email.trim().toLowerCase() !== again.trim().toLowerCase()) {
      change.setNote({ ok: false, text: S.adminAccountEmailMismatch });
      return;
    }
    const target = email.trim().toLowerCase();
    const done = await change.run(
      "change_email",
      () => S.adminAccountEmailChanged(target),
      target,
    );
    if (done) {
      setEmail("");
      setAgain("");
    }
  }

  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountEmailSection}</h3>
      {!detail.email_confirmed_at && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={confirm.busy}
            onClick={() =>
              void confirm.run(
                "confirm_email",
                () => S.adminAccountEmailConfirmedDone,
              )
            }
            data-testid="admin-account-confirm-email"
          >
            {S.adminAccountConfirmEmail}
          </Button>
          <NoteLine note={confirm.note} />
        </>
      )}
      <form
        className="admin-account-subform"
        onSubmit={submit}
        data-testid="admin-account-change-email"
      >
        <p className="admin-account-callout">{S.adminAccountEmailChangeNote}</p>
        <div className="admin-account-grid">
          <div className="ui-field">
            <label htmlFor="acct-email">{S.adminAccountNewEmail}</label>
            <Input
              id="acct-email"
              type="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="acct-email-again">
              {S.adminAccountNewEmailAgain}
            </label>
            <Input
              id="acct-email-again"
              type="email"
              dir="ltr"
              required
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
        </div>
        <NoteLine note={change.note} />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={change.busy}
        >
          {S.adminAccountChangeEmail}
        </Button>
      </form>
    </section>
  );
}

function StatusSection({
  detail,
  suspended,
}: {
  detail: AdminUserDetail;
  suspended: boolean;
}) {
  const S = useStrings();
  const { busy, note, run } = useAccountAction(detail.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="admin-account-section">
      <h3>{S.adminAccountStatus}</h3>
      <p className="admin-account-callout">{S.adminAccountSuspendNote}</p>
      <NoteLine note={note} />
      <div className="admin-account-row">
        {suspended ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run("unsuspend", () => S.adminAccountUnsuspendedDone)
            }
            data-testid="admin-account-unsuspend"
          >
            {S.adminAccountUnsuspend}
          </Button>
        ) : confirming ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void run("suspend", () => S.adminAccountSuspendedDone);
              }}
              data-testid="admin-account-suspend-confirm"
            >
              {S.adminAccountSuspendConfirm}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              {S.adminAccountCancel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirming(true)}
            data-testid="admin-account-suspend"
          >
            {S.adminAccountSuspend}
          </Button>
        )}
      </div>
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
                {auditActionLabel(h.action, S)}
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
