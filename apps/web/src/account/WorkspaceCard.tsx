/**
 * One workspace on the account page: its channel, where it is on the three
 * steps, and the one thing that moves it along — connecting, or the way to
 * the catalogue once it is connected.
 *
 * Presentational on purpose. The account page owns the session, the tables
 * and the requests; this takes rows and callbacks, so the owner's screen —
 * which the browser suite never reaches, because it runs signed out — can be
 * rendered and read in a unit test without standing up a session.
 *
 * Recomposed on `ui/` (phase 5): a `Card` as the list item, `Button`s for
 * the doors, `Input` for the rename form, and the disconnect / retire
 * questions in `ConfirmDialog` instead of an inline block. The props, the
 * step callbacks and every test id are the ones the page always used, so
 * its handlers did not move.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { setupProgress } from "../setup";
import { SetupPath } from "../SetupPath";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { ConfirmDialog } from "./ConfirmDialog";
import "./account.css";

export type ChannelRow = {
  workspace_id: string;
  channel_id: string;
  status: string;
  external_channel_id: string;
  handle: string | null;
  title: string | null;
};

export type JobRow = {
  workspace_id: string;
  status: string;
  created_at: string;
};

export function WorkspaceCard({
  workspace,
  hasClient,
  channel,
  latestJob,
  pending,
  feedback,
  onConnect,
  confirmingConnect = false,
  confirmingDisconnect = false,
  onDisconnect,
  renaming = false,
  onRename,
  confirmingRetire = false,
  onRetire,
}: {
  workspace: { id: string; name: string };
  /** A workspace cannot be connected without the client it owns. */
  hasClient: boolean;
  channel: ChannelRow | null;
  latestJob: JobRow | null;
  pending: boolean;
  /** What this card has to say for itself — its own note, or that it is working. */
  feedback: ReactNode;
  /** `ask` opens the "you're about to leave for Google" question; `continue`
   *  actually starts the redirect; `cancel` closes the question without one. */
  onConnect: (step: "ask" | "continue" | "cancel") => void;
  /** The connect/relink question is open; the page holds this state per card. */
  confirmingConnect?: boolean;
  /** The first press only asks; the page holds that state per card. */
  confirmingDisconnect?: boolean;
  /** `ask` opens the question, `confirm` disconnects, `keep` closes it. */
  onDisconnect?: (step: "ask" | "confirm" | "keep") => void;
  /** The rename form is open; the page holds that per card. */
  renaming?: boolean;
  /** `open` shows the form, `cancel` closes it, `save` carries the new name. */
  onRename?: (step: "open" | "cancel" | "save", name?: string) => void;
  confirmingRetire?: boolean;
  onRetire?: (step: "ask" | "confirm" | "keep") => void;
}) {
  const S = useStrings();
  const steps = setupProgress({ channel, latestJob }, S);
  const nameId = `rename-name-${workspace.id}`;
  const connected = channel?.status === "connected";
  // A channel connected before the callback asked Google for a name has
  // none stored, and a connected channel had no way back through consent
  // — the only door it showed was "collect". Going through consent again
  // is what stores the name (the attach function keeps the grant and fills
  // the blanks), so the way is offered exactly while there is a blank to
  // fill, and named for what it does rather than as a generic "reconnect"
  // a reader would take for a fault.
  const unnamed = connected && !channel.title && !channel.handle;

  return (
    <Card asChild className="db-ws">
      <li>
        {/* The name, and the way to change it: the form opens in the name's
            place with the current name already in it, so the reader edits
            rather than retypes. */}
        {renaming ? (
          <form
            className="db-ws-rename"
            data-testid={`rename-form-${workspace.id}`}
            onSubmit={(e) => {
              e.preventDefault();
              const field = e.currentTarget.elements.namedItem("name");
              onRename?.(
                "save",
                (field as HTMLInputElement | null)?.value ?? "",
              );
            }}
          >
            <label htmlFor={nameId}>{S.workspaceNameLabel}</label>
            <Input
              id={nameId}
              name="name"
              required
              maxLength={120}
              defaultValue={workspace.name}
              autoFocus
            />
            <div className="db-actions">
              <Button type="submit" disabled={pending}>
                {S.renameSave}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => onRename?.("cancel")}
              >
                {S.renameCancel}
              </Button>
            </div>
          </form>
        ) : (
          <div className="db-ws-head">
            <h3 className="db-ws-name">
              <bdi>{workspace.name}</bdi>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              data-testid={`rename-${workspace.id}`}
              onClick={() => onRename?.("open")}
            >
              {S.renameWorkspace}
            </Button>
          </div>
        )}
        {/* The channel by its name where one is known: the title it shows,
            else its @handle — in `bdi`, because a Latin handle inside an
            Arabic sentence otherwise drags its neighbours' direction with
            it. The id is what YouTube calls it — `UC…`, 24 opaque
            characters — and printing it as though it were the channel's
            name told the reader nothing they could recognise. When no name
            is stored the id is still shown, labelled as an id, because an
            unlabelled one reads as a fault. */}
        {channel ? (
          <p className="db-ws-channel" data-testid={`channel-${workspace.id}`}>
            {channel.status === "connected"
              ? S.channelConnected
              : channel.status === "public_unverified"
                ? S.channelSeeded
                : S.channelNeedsRelink(channel.status)}
            {channel.title || channel.handle ? (
              <bdi>{channel.title ?? channel.handle}</bdi>
            ) : (
              <>
                <span className="db-muted">{S.channelIdLabel}</span>{" "}
                <code>{channel.external_channel_id}</code>
              </>
            )}
          </p>
        ) : (
          <p
            className="db-ws-channel db-muted"
            data-testid={`channel-${workspace.id}`}
          >
            {S.channelNone}
          </p>
        )}
        {/* Where this workspace is on the three steps: the visitor's list,
            with a state on each line. */}
        <SetupPath steps={steps} testId={`setup-${workspace.id}`} />
        <div className="db-actions">
          {/* Connected: the next thing to do is choose what to collect.
              Collection is per video, chosen on the operations page, so the
              card points there — a link, not an action, because the choice
              is the action and it needs the catalogue in front of the
              reader. */}
          {connected && (
            <Button asChild>
              <Link
                to={`/sync?ws=${workspace.id}`}
                data-testid={`sync-${workspace.id}`}
              >
                {S.chooseVideos}
              </Link>
            </Button>
          )}
          {/* Shown only when it can actually work: without a client the
              server would refuse, and a button that always fails is worse
              than no button. */}
          {hasClient && !connected && !confirmingConnect && (
            <Button
              disabled={pending}
              data-testid={`connect-${workspace.id}`}
              onClick={() => onConnect("ask")}
            >
              {S.connectChannel}
            </Button>
          )}
          {hasClient && unnamed && !confirmingConnect && (
            <Button
              variant="secondary"
              disabled={pending}
              data-testid={`relink-${workspace.id}`}
              onClick={() => onConnect("ask")}
            >
              {S.relinkForName}
            </Button>
          )}
          {/* The way out, offered only while there is a grant to withdraw.
              Two presses on purpose: disconnecting stops every scheduled
              read and revokes the stored grant, and a single button beside
              "choose videos" would be pressed by mistake. What YouTube's
              audit asks for is that a user can withdraw access from inside
              the application; this is it. */}
          {connected && (
            <Button
              variant="ghost"
              disabled={pending}
              data-testid={`disconnect-${workspace.id}`}
              onClick={() => onDisconnect?.("ask")}
            >
              {S.disconnectChannel}
            </Button>
          )}
          {/* No handler, no door: the account page passes none to a platform
              admin, who has nobody to hand a workspace to but themself. The
              server refuses too (owner_cannot_retire); this is the courtesy. */}
          {onRetire && (
            <Button
              variant="ghost"
              className="db-ws-danger"
              disabled={pending}
              data-testid={`retire-${workspace.id}`}
              onClick={() => onRetire("ask")}
            >
              {S.retireWorkspace}
            </Button>
          )}
        </div>
        {/* Both connect doors lead to the same redirect and the same two
            Google warning screens (the app is pending Google's own review of
            the scope it asks for); the question is asked once, here, rather
            than split across two copies of the same panel. It stays inline
            — an explanation before leaving the page, not a confirmation —
            so it is a nested card, not a dialog. */}
        {confirmingConnect && (
          <Card
            className="db-ws-consent"
            role="group"
            aria-label={S.connectChannel}
          >
            <p>{S.connectAboutGoogle}</p>
            <div className="db-actions">
              <Button
                disabled={pending}
                data-testid={`connect-continue-${workspace.id}`}
                onClick={() => onConnect("continue")}
              >
                {S.connectContinueToGoogle}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => onConnect("cancel")}
              >
                {S.renameCancel}
              </Button>
            </div>
          </Card>
        )}
        {feedback}
        {/* The two questions, asked in a dialog. The page holds the "asking"
            state; every way out of the dialog reports `keep`, the same step
            the inline block's keep button reported. */}
        {connected && (
          <ConfirmDialog
            kind="disconnect"
            open={confirmingDisconnect}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            pending={pending}
            onConfirm={() => onDisconnect?.("confirm")}
            onClose={() => onDisconnect?.("keep")}
          />
        )}
        {onRetire && (
          <ConfirmDialog
            kind="retire"
            open={confirmingRetire}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            pending={pending}
            onConfirm={() => onRetire("confirm")}
            onClose={() => onRetire("keep")}
          />
        )}
      </li>
    </Card>
  );
}
