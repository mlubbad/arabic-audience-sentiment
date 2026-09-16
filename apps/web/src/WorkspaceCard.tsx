/**
 * One workspace on the account page: its channel, where it is on the three
 * steps, and the one thing that moves it along — connecting, or the way to
 * the catalogue once it is connected.
 *
 * Presentational on purpose. The account page owns the session, the tables
 * and the requests; this takes rows and callbacks, so the owner's screen —
 * which the browser suite never reaches, because it runs signed out — can be
 * rendered and read in a unit test without standing up a session.
 */
import type { ReactNode } from "react";
import { setupProgress } from "./setup";
import { SetupPath } from "./SetupPath";
import { useStrings } from "./strings";

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
  return (
    <li>
      {/* The name, and the way to change it: the form opens in the name's
          place with the current name already in it, so the reader edits
          rather than retypes. */}
      {renaming ? (
        <form
          className="rename-form"
          data-testid={`rename-form-${workspace.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            const field = e.currentTarget.elements.namedItem("name");
            onRename?.("save", (field as HTMLInputElement | null)?.value ?? "");
          }}
        >
          <label>
            {S.workspaceNameLabel}
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={workspace.name}
              autoFocus
            />
          </label>
          <button type="submit" disabled={pending}>
            {S.renameSave}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRename?.("cancel")}
          >
            {S.renameCancel}
          </button>
        </form>
      ) : (
        <strong>
          {workspace.name}{" "}
          <button
            type="button"
            className="link-button"
            disabled={pending}
            data-testid={`rename-${workspace.id}`}
            onClick={() => onRename?.("open")}
          >
            {S.renameWorkspace}
          </button>
        </strong>
      )}
      {/* The channel by its name where one is known: the title it shows,
          else its @handle. The id is what YouTube calls it — `UC…`, 24 opaque
          characters — and printing it as though it were the channel's name
          told the reader nothing they could recognise. When no name is stored
          the id is still shown, labelled as an id, because an unlabelled one
          reads as a fault. */}
      {channel ? (
        <span data-testid={`channel-${workspace.id}`}>
          {channel.status === "connected"
            ? S.channelConnected
            : channel.status === "public_unverified"
              ? S.channelSeeded
              : S.channelNeedsRelink(channel.status)}
          {channel.title || channel.handle ? (
            <b>{channel.title ?? channel.handle}</b>
          ) : (
            <>
              <span className="muted">{S.channelIdLabel}</span>{" "}
              <code>{channel.external_channel_id}</code>
            </>
          )}
        </span>
      ) : (
        <span>{S.channelNone}</span>
      )}
      {/* Where this workspace is on the three steps: the visitor's list, with
          a state on each line. */}
      <SetupPath steps={steps} testId={`setup-${workspace.id}`} />
      {/* Shown only when it can actually work: without a client the server
          would refuse, and a button that always fails is worse than no button. */}
      {/* Connected: the next thing to do is choose what to collect. This was
          a "request sync" button that enqueued a whole-channel job from here;
          collection is now per video, chosen on the operations page, so the
          card points there — a link, not an action, because the choice is
          the action and it needs the catalogue in front of the reader. */}
      {channel?.status === "connected" && (
        <a
          href={`/sync?ws=${workspace.id}`}
          data-testid={`sync-${workspace.id}`}
        >
          {S.chooseVideos}
        </a>
      )}
      {hasClient && channel?.status !== "connected" && !confirmingConnect && (
        <button
          type="button"
          disabled={pending}
          data-testid={`connect-${workspace.id}`}
          onClick={() => onConnect("ask")}
        >
          {S.connectChannel}
        </button>
      )}
      {/* A channel connected before the callback asked Google for a name has
          none stored, and a connected channel had no way back through consent
          — the only button it showed was "collect". Going through consent
          again is what stores the name (the attach function keeps the grant
          and fills the blanks), so the way is offered exactly while there is a
          blank to fill, and named for what it does rather than as a generic
          "reconnect" a reader would take for a fault. */}
      {hasClient &&
        channel?.status === "connected" &&
        !channel.title &&
        !channel.handle &&
        !confirmingConnect && (
          <button
            type="button"
            disabled={pending}
            data-testid={`relink-${workspace.id}`}
            onClick={() => onConnect("ask")}
          >
            {S.relinkForName}
          </button>
        )}
      {/* Both doors above lead to the same redirect and the same two Google
          warning screens (the app is pending Google's own review of the
          scope it asks for); the question is asked once, here, rather than
          split across two copies of the same panel. */}
      {confirmingConnect && (
        <span
          className="disconnect-confirm"
          role="group"
          aria-label={S.connectChannel}
        >
          <span>{S.connectAboutGoogle}</span>
          <button
            type="button"
            disabled={pending}
            data-testid={`connect-continue-${workspace.id}`}
            onClick={() => onConnect("continue")}
          >
            {S.connectContinueToGoogle}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onConnect("cancel")}
          >
            {S.renameCancel}
          </button>
        </span>
      )}
      {/* The way out, offered only while there is a grant to withdraw. Two
          presses on purpose: disconnecting stops every scheduled read and
          revokes the stored grant, and a single button beside "choose videos"
          would be pressed by mistake. What YouTube's audit asks for is that a
          user can withdraw access from inside the application; this is it. */}
      {channel?.status === "connected" &&
        (confirmingDisconnect ? (
          <span
            className="disconnect-confirm"
            role="group"
            aria-label={S.disconnectChannel}
          >
            <span>{S.disconnectConfirm}</span>
            <button
              type="button"
              disabled={pending}
              data-testid={`disconnect-confirm-${workspace.id}`}
              onClick={() => onDisconnect?.("confirm")}
            >
              {S.disconnectChannel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDisconnect?.("keep")}
            >
              {S.disconnectKeep}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="link-button"
            disabled={pending}
            data-testid={`disconnect-${workspace.id}`}
            onClick={() => onDisconnect?.("ask")}
          >
            {S.disconnectChannel}
          </button>
        ))}
      {/* No handler, no door: the account page passes none to a platform
          admin, who has nobody to hand a workspace to but themself. The
          server refuses too (owner_cannot_retire); this is the courtesy. */}
      {!onRetire ? null : confirmingRetire ? (
        <span
          className="disconnect-confirm"
          role="group"
          aria-label={S.retireWorkspace}
        >
          <span>{S.retireConfirm}</span>
          <button
            type="button"
            disabled={pending}
            data-testid={`retire-confirm-${workspace.id}`}
            onClick={() => onRetire?.("confirm")}
          >
            {S.retireWorkspace}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRetire?.("keep")}
          >
            {S.retireKeep}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="link-button link-button-danger"
          disabled={pending}
          data-testid={`retire-${workspace.id}`}
          onClick={() => onRetire?.("ask")}
        >
          {S.retireWorkspace}
        </button>
      )}
      {feedback}
    </li>
  );
}
