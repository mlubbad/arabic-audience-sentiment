/**
 * The disconnect / retire confirmation, on `ui/Dialog`.
 *
 * One component, words by `kind`: the same title, sentence, confirm and keep
 * words the workspace card's inline blocks carried before the question moved
 * into a dialog. The card's owner still holds the "asking" state — `open`
 * is that state and every way out (the keep button, the corner ✕, Escape,
 * the overlay) reports through `onClose`, so `Account.tsx`'s `keep` step
 * arrives exactly as it did from the inline block.
 *
 * The workspace's name is printed under the title because the dialog is
 * detached from the card that opened it: a modal that only says "retire
 * the workspace" leaves the reader with three cards behind it to guess
 * between.
 */
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";
import { useStrings } from "../strings";
import "./account.css";

export type ConfirmKind = "disconnect" | "retire";

export function ConfirmDialog({
  open,
  kind,
  workspaceId,
  workspaceName,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  kind: ConfirmKind;
  workspaceId: string;
  workspaceName: string;
  /** The confirmed action is in flight: both buttons wait, and the dialog
   *  refuses to close until the owner closes it by dropping `open`. */
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const S = useStrings();
  const words =
    kind === "disconnect"
      ? {
          title: S.disconnectChannel,
          body: S.disconnectConfirm,
          confirm: S.disconnectChannel,
          keep: S.disconnectKeep,
        }
      : {
          title: S.retireWorkspace,
          body: S.retireConfirm,
          confirm: S.retireWorkspace,
          keep: S.retireKeep,
        };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape, the overlay and the corner ✕ all route through here; a
        // confirm in flight cannot be backed out of, so the close is refused
        // while it runs — the owner closes the dialog when the call answers.
        if (!next && pending) return;
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="db-confirm"
        data-testid={`${kind}-dialog-${workspaceId}`}
        closeLabel={words.keep}
        closeTestId={`${kind}-cancel-${workspaceId}`}
      >
        <DialogTitle>{words.title}</DialogTitle>
        <p className="db-muted db-confirm-name">
          <bdi>{workspaceName}</bdi>
        </p>
        <DialogDescription>{words.body}</DialogDescription>
        <div className="db-actions">
          <Button
            variant={kind === "retire" ? "danger" : "primary"}
            disabled={pending}
            data-testid={`${kind}-confirm-${workspaceId}`}
            onClick={onConfirm}
          >
            {words.confirm}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {words.keep}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
