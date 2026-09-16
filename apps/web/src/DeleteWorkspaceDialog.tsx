/**
 * The operator's delete. A real deletion, so the dialog says exactly what
 * goes — counted, from the server — and asks for the workspace's name typed
 * back before the confirm button will enable. The refusals are the
 * function's; this only says them.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useStrings } from "./strings";
import { adminErrorMessage } from "./adminWords";
import { Button } from "./ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/Dialog";
import { Input } from "./ui/Input";
import { toast } from "./ui/Toast";

interface Footprint {
  channels: number;
  videos: number;
  comments: number;
  predictions: number;
  reviews: number;
  members: number;
}

export function DeleteWorkspaceDialog({
  workspace,
  onDeleted,
}: {
  workspace: { id: string; name: string };
  onDeleted: () => void;
}) {
  const S = useStrings();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Counted when the dialog opens, not on mount: the admin table has a row
  // per workspace and this must not fire a query for each on page load.
  useEffect(() => {
    if (!open || !supabase) return;
    let live = true;
    setFootprint(null);
    void supabase
      .rpc("admin_workspace_footprint", { w: workspace.id })
      .then(({ data }) => {
        if (live && data) setFootprint(data as Footprint);
      });
    return () => {
      live = false;
    };
  }, [open, workspace.id]);

  const inputId = `delete-name-${workspace.id}`;
  const matches = typed.trim() === workspace.name.trim();

  function confirm() {
    if (!supabase || !matches) return;
    setBusy(true);
    setFailure(null);
    void supabase
      .rpc("delete_workspace", { w: workspace.id })
      .then(({ error }) => {
        setBusy(false);
        if (error) {
          setFailure(adminErrorMessage(error, S));
          return;
        }
        setOpen(false);
        toast({ title: S.adminDeleteDone(workspace.name) });
        onDeleted();
      });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A delete in flight cannot be backed out of — the row is already
        // going. Escape, the overlay and the corner ✕ all route through here,
        // so refusing the close while busy covers every way out at once.
        if (!next && busy) return;
        setOpen(next);
        if (!next) {
          setTyped("");
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {S.adminDelete}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={S.adminDeleteClose}>
        <DialogTitle>{S.adminDeleteTitle(workspace.name)}</DialogTitle>
        <DialogDescription>{S.adminDeleteLead}</DialogDescription>
        <p className="ui-num">
          {footprint
            ? S.adminDeleteFootprint(footprint)
            : S.adminDeleteFootprintReading}
        </p>
        <label htmlFor={inputId}>{S.adminDeleteTypeName(workspace.name)}</label>
        <Input
          id={inputId}
          value={typed}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
        {failure && <p role="alert">{failure}</p>}
        <div className="admin-delete-actions">
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {S.adminDeleteCancel}
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={!matches || busy}
            onClick={confirm}
          >
            {S.adminDeleteConfirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
