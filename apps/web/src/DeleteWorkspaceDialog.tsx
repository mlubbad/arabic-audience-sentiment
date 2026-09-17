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

export interface Footprint {
  channels: number;
  videos: number;
  comments: number;
  predictions: number;
  reviews: number;
  members: number;
}

/** The two server calls, as the dialog makes them by default. Thrown as they
 *  came: the sentence is chosen where it is shown, from the code alone. */
async function countOnServer(w: string): Promise<Footprint> {
  const { data, error } = await supabase!.rpc("admin_workspace_footprint", {
    w,
  });
  if (error) throw error;
  return data as Footprint;
}
async function deleteOnServer(w: string): Promise<void> {
  const { error } = await supabase!.rpc("delete_workspace", { w });
  if (error) throw error;
}

/**
 * `onConfirm` and `readFootprint` are the two calls the dialog makes, and
 * both default to the RPCs. The admin demo (`admin/AdminPage.tsx` behind
 * `?demo=1`) passes its reducer for the first and a fixed count for the
 * second; a refusal thrown by either lands in the same `role="alert"` line
 * through `adminErrorMessage`, so the demo says exactly what the server
 * would. `onDeleted` is what the page does once the row is gone — the live
 * page re-reads its lists; the demo's rows already changed in `onConfirm`.
 */
export function DeleteWorkspaceDialog({
  workspace,
  onDeleted,
  onConfirm,
  readFootprint,
}: {
  workspace: { id: string; name: string };
  onDeleted?: () => void;
  onConfirm?: () => Promise<void>;
  readFootprint?: () => Promise<Footprint>;
}) {
  const S = useStrings();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [footprintError, setFootprintError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // With neither injected and Supabase unconfigured there is nothing to
  // count or delete against: the dialog opens and counts forever, and
  // confirm never enables — the same as before the props existed.
  const count =
    readFootprint ?? (supabase && (() => countOnServer(workspace.id)));
  const remove =
    onConfirm ?? (supabase && (() => deleteOnServer(workspace.id)));

  // Counted when the dialog opens, not on mount: the admin table has a row
  // per workspace and this must not fire a query for each on page load.
  useEffect(() => {
    if (!open || !count) return;
    let live = true;
    setFootprint(null);
    setFootprintError(null);
    count().then(
      (data) => {
        if (live && data) setFootprint(data);
      },
      (error: unknown) => {
        if (live) setFootprintError(adminErrorMessage(error, S));
      },
    );
    return () => {
      live = false;
    };
  }, [open, workspace.id]);

  const inputId = `delete-name-${workspace.id}`;
  const matches = typed.trim() === workspace.name.trim();

  function confirm() {
    if (!remove || !matches) return;
    setBusy(true);
    setFailure(null);
    remove().then(
      () => {
        setBusy(false);
        setOpen(false);
        toast({ title: S.adminDeleteDone(workspace.name) });
        onDeleted?.();
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(adminErrorMessage(error, S));
      },
    );
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
          setFootprintError(null);
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
        {(failure || footprintError) && (
          <p role="alert">{failure ?? footprintError}</p>
        )}
        <div className="admin-delete-actions">
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {S.adminDeleteCancel}
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={!matches || busy || !footprint}
            onClick={confirm}
          >
            {S.adminDeleteConfirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
