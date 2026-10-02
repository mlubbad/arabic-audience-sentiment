import { useEffect, useState } from "react";
import type { WorkspaceAccount } from "@sentiment/contracts";
import { supabase } from "../supabase";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import "./account.css";

export function buildShareWorkspaceRpcArgs(
  action: "share_workspace",
  params: {
    w: string;
    account_email: string;
    account_role: "analyst" | "viewer";
  },
): { w: string; account_email: string; account_role: "analyst" | "viewer" };
export function buildShareWorkspaceRpcArgs(
  action: "unshare_workspace",
  params: { w: string; target_user_id: string },
): { w: string; target_user_id: string };
export function buildShareWorkspaceRpcArgs(
  action: "update_workspace_account_role",
  params: {
    w: string;
    target_user_id: string;
    new_role: "analyst" | "viewer";
  },
): { w: string; target_user_id: string; new_role: "analyst" | "viewer" };
export function buildShareWorkspaceRpcArgs(
  action:
    "share_workspace" | "unshare_workspace" | "update_workspace_account_role",
  params: {
    w: string;
    account_email?: string;
    account_role?: "analyst" | "viewer";
    target_user_id?: string;
    new_role?: "analyst" | "viewer";
  },
) {
  switch (action) {
    case "share_workspace":
      return {
        w: params.w,
        account_email: (params.account_email ?? "").trim().toLowerCase(),
        account_role: params.account_role ?? "analyst",
      };
    case "unshare_workspace":
      return {
        w: params.w,
        target_user_id: params.target_user_id!,
      };
    case "update_workspace_account_role":
      return {
        w: params.w,
        target_user_id: params.target_user_id!,
        new_role: params.new_role ?? "viewer",
      };
  }
}

export function ShareWorkspaceDialog({
  open,
  workspaceId,
  workspaceName,
  onClose,
}: {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const S = useStrings();
  const [accounts, setAccounts] = useState<WorkspaceAccount[]>([]);
  const [membersCount, setMembersCount] = useState(1);
  const [membersLimit, setMembersLimit] = useState<number | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"analyst" | "viewer">("analyst");

  const loadAccounts = async () => {
    if (!supabase) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc("list_workspace_accounts", {
        w: workspaceId,
      });
      if (error) {
        setErrorMsg(error.message);
      } else if (data) {
        const res = data as {
          accounts: WorkspaceAccount[];
          members_count?: number;
          total_members?: number;
          members_limit?: number | null;
          can_manage?: boolean;
        };
        const count =
          res.total_members ?? res.members_count ?? res.accounts?.length ?? 1;
        setAccounts(res.accounts || []);
        setMembersCount(count);
        const parsedLimit =
          res.members_limit !== null &&
          res.members_limit !== undefined &&
          !isNaN(Number(res.members_limit))
            ? Number(res.members_limit)
            : null;
        setMembersLimit(parsedLimit);

        let canManageFlag = res.can_manage;
        if (canManageFlag === undefined) {
          try {
            const authUser = (await supabase.auth.getUser())?.data?.user;
            if (authUser) {
              const myAcc = res.accounts?.find(
                (a) => a.user_id === authUser.id,
              );
              canManageFlag = myAcc ? myAcc.is_owner : true;
            } else {
              canManageFlag = true;
            }
          } catch {
            canManageFlag = true;
          }
        }
        setCanManage(Boolean(canManageFlag));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setEmail("");
      setErrorMsg(null);
      setSuccessMsg(null);
      void loadAccounts();
    }
  }, [open, workspaceId]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail || !supabase) return;

    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const args = buildShareWorkspaceRpcArgs("share_workspace", {
        w: workspaceId,
        account_email: targetEmail,
        account_role: role,
      });
      const { error } = await supabase.rpc("share_workspace", args);

      if (error) {
        const code = error.message;
        if (code === "user_not_found") {
          setErrorMsg(S.shareWorkspaceUserNotFound);
        } else if (code === "members_limit_reached") {
          setErrorMsg(S.shareWorkspaceLimitReached);
        } else if (code === "already_member") {
          setErrorMsg(S.shareWorkspaceAlreadyMember);
        } else {
          setErrorMsg(error.message);
        }
      } else {
        setSuccessMsg(S.shareWorkspaceDone);
        setEmail("");
        await loadAccounts();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleUnshare = async (targetUserId: string) => {
    if (!supabase) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const args = buildShareWorkspaceRpcArgs("unshare_workspace", {
        w: workspaceId,
        target_user_id: targetUserId,
      });
      const { error } = await supabase.rpc("unshare_workspace", args);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg(S.shareWorkspaceUnsharedDone);
        await loadAccounts();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (
    targetUserId: string,
    newRole: "analyst" | "viewer",
  ) => {
    if (!supabase) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const args = buildShareWorkspaceRpcArgs("update_workspace_account_role", {
        w: workspaceId,
        target_user_id: targetUserId,
        new_role: newRole,
      });
      const { error } = await supabase.rpc(
        "update_workspace_account_role",
        args,
      );
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg(S.shareWorkspaceRoleUpdatedDone);
        await loadAccounts();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const limitReached = membersLimit !== null && membersCount >= membersLimit;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="db-share-dialog"
        data-testid={`share-dialog-${workspaceId}`}
        closeLabel={S.shareWorkspaceClose}
        closeTestId={`share-close-${workspaceId}`}
      >
        <DialogTitle>{S.shareWorkspaceTitle(workspaceName)}</DialogTitle>
        <p className="db-muted db-confirm-name">
          <bdi>{workspaceName}</bdi>
        </p>
        <DialogDescription>{S.shareWorkspaceLead}</DialogDescription>

        <div className="db-share-limit-bar">
          <span className="ui-num">
            {S.shareWorkspaceAccountsCount(membersCount, membersLimit)}
          </span>
        </div>

        {canManage && (
          <form
            className="db-share-add-form"
            onSubmit={(e) => void handleShare(e)}
            data-testid="share-add-form"
          >
            <div className="db-share-inputs">
              <Input
                type="email"
                required
                dir="ltr"
                placeholder={S.shareWorkspaceEmailPlaceholder}
                aria-label={S.shareWorkspaceEmailLabel}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || limitReached}
                data-testid="share-email-input"
              />
              <Select
                value={role}
                onValueChange={(val) => setRole(val as "analyst" | "viewer")}
                disabled={busy || limitReached}
              >
                <SelectTrigger
                  aria-label={S.shareWorkspaceRoleLabel}
                  data-testid="share-role-select"
                  className="db-share-role-trigger"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyst">
                    {S.shareWorkspaceRoleAnalyst}
                  </SelectItem>
                  <SelectItem value="viewer">
                    {S.shareWorkspaceRoleViewer}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !email.trim() || limitReached}
              data-testid="share-submit-btn"
            >
              {busy ? S.working : S.shareWorkspaceSubmit}
            </Button>
          </form>
        )}

        {limitReached && canManage && (
          <p className="db-feedback db-share-limit-warning">
            {S.shareWorkspaceLimitReached}
          </p>
        )}

        {errorMsg && (
          <p
            className="db-feedback db-ws-danger"
            role="alert"
            data-testid="share-error"
          >
            {errorMsg}
          </p>
        )}

        {successMsg && (
          <p
            className="db-feedback db-share-success"
            role="status"
            data-testid="share-success"
          >
            {successMsg}
          </p>
        )}

        <div className="db-share-accounts-section">
          <h4 className="db-share-accounts-title">
            {S.shareWorkspaceAccountsList}
          </h4>

          {loading ? (
            <p className="db-muted db-feedback">{S.working}</p>
          ) : (
            <ul className="db-share-accounts-list" role="list">
              {accounts.map((acc) => (
                <li
                  key={acc.user_id}
                  className="db-share-account-row"
                  data-testid={`share-account-${acc.user_id}`}
                >
                  <div className="db-share-account-info">
                    <span className="db-share-account-email" dir="ltr">
                      {acc.email}
                    </span>
                    {acc.is_owner ? (
                      <Badge tone="sentiment-neutral">
                        {S.shareWorkspaceRoleOwner}
                      </Badge>
                    ) : (
                      <Badge
                        tone={acc.role === "analyst" ? "positive" : "neutral"}
                      >
                        {acc.role === "analyst"
                          ? S.shareWorkspaceRoleAnalystBadge
                          : S.shareWorkspaceRoleViewerBadge}
                      </Badge>
                    )}
                  </div>

                  {canManage && !acc.is_owner && (
                    <div className="db-share-account-actions">
                      <Select
                        value={acc.role}
                        onValueChange={(val) =>
                          void handleRoleChange(
                            acc.user_id,
                            val as "analyst" | "viewer",
                          )
                        }
                        disabled={busy}
                      >
                        <SelectTrigger
                          aria-label={S.shareWorkspaceRoleLabel}
                          data-testid={`share-role-change-${acc.user_id}`}
                          className="db-share-role-change-trigger"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="analyst">
                            {S.shareWorkspaceRoleAnalyst}
                          </SelectItem>
                          <SelectItem value="viewer">
                            {S.shareWorkspaceRoleViewer}
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="db-ws-danger"
                        disabled={busy}
                        data-testid={`share-remove-${acc.user_id}`}
                        onClick={() => void handleUnshare(acc.user_id)}
                      >
                        {S.shareWorkspaceUnshare}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="db-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {S.shareWorkspaceClose}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
