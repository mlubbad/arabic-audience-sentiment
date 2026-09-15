/**
 * One workspace on the account page: its channel, where it is on the three
 * steps, and the one action that moves it along.
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
  onSync,
  onConnect,
}: {
  workspace: { id: string; name: string };
  /** A workspace cannot be connected without the client it owns. */
  hasClient: boolean;
  channel: ChannelRow | null;
  latestJob: JobRow | null;
  pending: boolean;
  /** What this card has to say for itself — its own note, or that it is working. */
  feedback: ReactNode;
  onSync: (channel: ChannelRow) => void;
  onConnect: () => void;
}) {
  const S = useStrings();
  const steps = setupProgress({ channel, latestJob }, S);
  return (
    <li>
      <strong>{workspace.name}</strong>
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
      {/* Connected: the next thing to do is collect. enqueue_sync creates the
          job; a worker picks it up. Both halves are said plainly in the
          message, because a queued job with no worker looks identical to
          nothing happening. */}
      {channel?.status === "connected" && (
        <button
          type="button"
          disabled={pending}
          data-testid={`sync-${workspace.id}`}
          onClick={() => onSync(channel)}
        >
          {S.requestSync}
        </button>
      )}
      {hasClient && channel?.status !== "connected" && (
        <button
          type="button"
          disabled={pending}
          data-testid={`connect-${workspace.id}`}
          onClick={onConnect}
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
        !channel.handle && (
          <button
            type="button"
            disabled={pending}
            data-testid={`relink-${workspace.id}`}
            onClick={onConnect}
          >
            {S.relinkForName}
          </button>
        )}
      {feedback}
    </li>
  );
}
