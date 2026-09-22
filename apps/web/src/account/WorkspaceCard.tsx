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
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { ChannelCandidate, SourcePlatform } from "@sentiment/contracts";
import { setupProgress } from "../setup";
import { SetupPath } from "../SetupPath";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShareWorkspaceDialog } from "./ShareWorkspaceDialog";
import "./account.css";

export type ChannelRow = {
  workspace_id: string;
  channel_id: string;
  status: string;
  external_channel_id: string;
  handle: string | null;
  title: string | null;
  platform?: string;
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
  confirmingDisconnect = false,
  onDisconnect,
  onAddChannel,
  addingChannel = false,
  channelCandidates = null,
  channelLookupError = null,
  renaming = false,
  onRename,
  confirmingRetire = false,
  onRetire,
  sharing,
  onShare,
  tourAnchor,
  allowPublicChannels = false,
}: {
  workspace: { id: string; name: string };
  /** A workspace cannot be connected without the client it owns. */
  hasClient: boolean;
  channel: ChannelRow | null;
  latestJob: JobRow | null;
  pending: boolean;
  /** What this card has to say for itself — its own note, or that it is working. */
  feedback: ReactNode;
  /** Starts the OAuth connect or relink redirect to Google. */
  onConnect: () => void;
  /** The public-data door: `open` shows the form, `cancel` closes it,
   *  `search` looks a query up on the server, `add` files the candidate.
   *  The page owns the lookup and the registration; this card only shows
   *  what came back. Optional: the demo body has no server to ask. */
  onAddChannel?: (
    step: "open" | "cancel" | "search" | "add" | "clear-error",
    value?: string,
    candidate?: ChannelCandidate,
    platform?: SourcePlatform,
  ) => void;
  /** The add-channel form is open; the page holds that per card. */
  addingChannel?: boolean;
  /** The lookup's answers, or null while none have come back. */
  channelCandidates?: ChannelCandidate[] | null;
  /** Why the last lookup said no, in the reader's language. */
  channelLookupError?: string | null;
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
  sharing?: boolean;
  onShare?: (open: boolean) => void;
  /** The onboarding tour's `data-tour` name for this card — the page gives
   *  it to the first card only, and that card's setup path is lit too. */
  tourAnchor?: string;
  /** Whether this workspace/account is permitted to use the public channel tracking option ("لا أملك القناة"). */
  allowPublicChannels?: boolean;
}) {
  const S = useStrings();
  const [internalShareOpen, setInternalShareOpen] = useState(false);
  const shareOpen = sharing !== undefined ? sharing : internalShareOpen;
  const setShareOpen = (open: boolean) => {
    setInternalShareOpen(open);
    onShare?.(open);
  };
  const steps = setupProgress({ channel, latestJob }, S);
  const nameId = `rename-name-${workspace.id}`;
  const addChannelQueryId = `addchannel-query-${workspace.id}`;
  const addTelegramInputId = `addtelegram-handle-${workspace.id}`;
  const addXInputId = `addx-handle-${workspace.id}`;
  const addTikTokInputId = `addtiktok-handle-${workspace.id}`;
  const [query, setQuery] = useState("");
  const [addPlatform, setAddPlatform] = useState<
    "youtube" | "telegram" | "x" | "tiktok"
  >("youtube");
  const [telegramHandle, setTelegramHandle] = useState("");
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [xHandle, setXHandle] = useState("");
  const [xError, setXError] = useState<string | null>(null);
  const [tikTokHandle, setTikTokHandle] = useState("");
  const [tikTokError, setTikTokError] = useState<string | null>(null);

  function cleanTelegramHandle(raw: string): string | null {
    let s = raw.trim();
    s = s.replace(/^https?:\/\/(www\.)?t\.me\//i, "");
    s = s.replace(/^t\.me\//i, "");
    s = s.replace(/^\//, "");
    s = s.replace(/\/.*$/, "");
    if (!s) return null;
    if (!s.startsWith("@")) s = "@" + s;
    if (!/^@[A-Za-z0-9_]{4,64}$/.test(s)) return null;
    return s;
  }

  function cleanXHandle(raw: string): string | null {
    let s = raw.trim();
    s = s.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
    s = s.replace(/^(twitter|x)\.com\//i, "");
    s = s.replace(/^\/?@?/, "");
    s = s.replace(/\/.*$/, "").replace(/\?.*$/, "").trim();
    if (!s || !/^[A-Za-z0-9_]{1,15}$/.test(s)) return null;
    return s;
  }

  function cleanTikTokHandle(raw: string): string | null {
    let s = raw.trim();
    s = s.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "");
    s = s.replace(/^tiktok\.com\/@?/i, "");
    s = s.replace(/^\/?@?/, "");
    s = s.replace(/\/.*$/, "").replace(/\?.*$/, "").trim();
    if (!s || !/^[A-Za-z0-9_.-]{2,30}$/.test(s)) return null;
    return s;
  }

  function handleTelegramSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const s = cleanTelegramHandle(telegramHandle);
    if (!s) {
      setTelegramError(S.addTelegramInvalidHandle);
      return;
    }
    setTelegramError(null);
    onAddChannel?.("search", s, undefined, "telegram");
  }

  function handleTelegramSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = cleanTelegramHandle(telegramHandle);
    if (!s) {
      setTelegramError(S.addTelegramInvalidHandle);
      return;
    }
    setTelegramError(null);
    onAddChannel?.("add", undefined, {
      external_channel_id: s,
      handle: s,
      title: s,
      thumbnail_url: null,
      platform: "telegram",
    });
  }

  function handleXSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const s = cleanXHandle(xHandle);
    if (!s) {
      setXError(S.addXInvalidHandle);
      return;
    }
    setXError(null);
    onAddChannel?.("search", s, undefined, "x");
  }

  function handleXSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = cleanXHandle(xHandle);
    if (!s) {
      setXError(S.addXInvalidHandle);
      return;
    }
    setXError(null);
    onAddChannel?.("add", undefined, {
      external_channel_id: s,
      handle: "@" + s,
      title: "@" + s,
      thumbnail_url: null,
      platform: "x",
    });
  }

  function handleTikTokSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const s = cleanTikTokHandle(tikTokHandle);
    if (!s) {
      setTikTokError(S.addTikTokInvalidHandle);
      return;
    }
    setTikTokError(null);
    onAddChannel?.("search", s, undefined, "tiktok");
  }

  function handleTikTokSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = cleanTikTokHandle(tikTokHandle);
    if (!s) {
      setTikTokError(S.addTikTokInvalidHandle);
      return;
    }
    setTikTokError(null);
    onAddChannel?.("add", undefined, {
      external_channel_id: s,
      handle: "@" + s,
      title: "@" + s,
      thumbnail_url: null,
      platform: "tiktok",
    });
  }

  function handleDirectAddForCurrentPlatform() {
    const fakeEv = { preventDefault: () => {} } as React.FormEvent;
    if (addPlatform === "telegram") handleTelegramSubmit(fakeEv);
    else if (addPlatform === "x") handleXSubmit(fakeEv);
    else if (addPlatform === "tiktok") handleTikTokSubmit(fakeEv);
  }
  const connected = channel?.status === "connected";
  const hasPublicChannel = channel?.status === "public_unverified";
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
      <li data-tour={tourAnchor}>
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
            <div className="db-ws-head-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                data-testid={`share-${workspace.id}`}
                onClick={() => setShareOpen(true)}
              >
                {S.shareWorkspace}
              </Button>
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
            {channel.platform && channel.platform !== "youtube" && (
              <span
                className="ui-badge ui-badge--neutral"
                style={{ marginInlineEnd: "0.5rem" }}
              >
                {channel.platform === "telegram"
                  ? S.platformTelegram
                  : channel.platform === "x"
                    ? S.platformX
                    : channel.platform === "tiktok"
                      ? S.platformTikTok
                      : channel.platform}
              </span>
            )}
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
        <SetupPath
          steps={steps}
          testId={`setup-${workspace.id}`}
          tourAnchor={tourAnchor ? "setup" : undefined}
        />

        {/* When the workspace names no channel: present the two mutually exclusive
            paths (Owner vs Public) as one unified decision if allowed; otherwise offer direct owner connect. */}
        {(!channel || channel.status === "disconnected") &&
          allowPublicChannels && (
            <div
              className="db-channel-setup"
              data-testid={`channel-setup-${workspace.id}`}
            >
              <div className="db-channel-setup-header">
                <h4 className="db-channel-setup-title">
                  {S.channelSetupHeading}
                </h4>
                <p className="db-channel-setup-sub">
                  {S.channelSetupSubheading}
                </p>
              </div>
              <div className="db-channel-setup-grid">
                <div className="db-channel-choice db-channel-choice--owner">
                  <div className="db-channel-choice-head">
                    <h5 className="db-channel-choice-title">
                      {S.channelOptionOwnerTitle}
                    </h5>
                    <span className="db-channel-choice-badge">
                      {S.channelOptionOwnerBadge}
                    </span>
                  </div>
                  <p className="db-channel-choice-desc">
                    {S.channelOptionOwnerDesc}
                  </p>
                  <div className="db-actions">
                    {hasClient && (
                      <Button
                        disabled={pending}
                        data-testid={`connect-${workspace.id}`}
                        onClick={onConnect}
                      >
                        {S.connectChannel}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="db-channel-choice db-channel-choice--public">
                  <div className="db-channel-choice-head">
                    <h5 className="db-channel-choice-title">
                      {S.channelOptionPublicTitle}
                    </h5>
                    <span className="db-channel-choice-badge">
                      {S.channelOptionPublicBadge}
                    </span>
                  </div>
                  <p className="db-channel-choice-desc">
                    {S.channelOptionPublicDesc}
                  </p>
                  <div className="db-actions">
                    {hasClient && onAddChannel && !addingChannel && (
                      <Button
                        variant="secondary"
                        disabled={pending}
                        data-testid={`addchannel-${workspace.id}`}
                        onClick={() => onAddChannel("open")}
                      >
                        {S.channelOptionPublicAction}
                      </Button>
                    )}
                    {hasClient && onAddChannel && addingChannel && (
                      <Button
                        variant="ghost"
                        disabled={pending}
                        onClick={() => onAddChannel("cancel")}
                      >
                        {S.addChannelCancel}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* When public channels are not permitted for this account type: render direct connect button */}
        {(!channel || channel.status === "disconnected") &&
          !allowPublicChannels && (
            <div className="db-actions">
              {hasClient && (
                <Button
                  disabled={pending}
                  data-testid={`connect-${workspace.id}`}
                  onClick={onConnect}
                >
                  {S.connectChannel}
                </Button>
              )}
            </div>
          )}

        {/* Action doors for existing channels or workspace-level actions */}
        {(connected ||
          hasPublicChannel ||
          channel?.status === "reconnect_required" ||
          onRetire) && (
          <div className="db-actions">
            {/* Connected or chosen public channel: proceed to choose what to collect. */}
            {(connected || hasPublicChannel) && (
              <Button asChild>
                <Link
                  to={`/sync?ws=${workspace.id}`}
                  data-testid={`sync-${workspace.id}`}
                >
                  {S.chooseVideos}
                </Link>
              </Button>
            )}
            {/* Reconnect door: offered ONLY when a previously connected channel's grant lapsed. */}
            {hasClient && channel?.status === "reconnect_required" && (
              <Button
                disabled={pending}
                data-testid={`connect-${workspace.id}`}
                onClick={onConnect}
              >
                {S.connectChannel}
              </Button>
            )}
            {hasClient && unnamed && (
              <Button
                variant="secondary"
                disabled={pending}
                data-testid={`relink-${workspace.id}`}
                onClick={onConnect}
              >
                {S.relinkForName}
              </Button>
            )}
            {/* The way out: offered while there is a grant or public channel to withdraw. */}
            {(connected || hasPublicChannel) && (
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
                admin, who has nobody to hand a workspace to but themself. */}
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
        )}
        {feedback}
        {/* The public-data door's form: a query in, candidates out, one add
            button per candidate. Inline like the Google consent card above —
            an explanation and a way back, not a dialog. The thumbnail and the
            name are what the reader recognises the channel by; the id is
            shown only when the source gave neither a name nor a handle. */}
        {addingChannel && onAddChannel && allowPublicChannels && (
          <Card
            className="db-ws-consent"
            role="group"
            aria-label={S.addChannel}
          >
            <p
              style={{
                marginBottom: "0.75rem",
                fontWeight: 600,
                color: "var(--text-1)",
              }}
            >
              {S.searchPublicChannelHeading}
            </p>
            <div
              className="db-actions"
              style={{
                marginBottom: "1rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
              role="tablist"
              aria-label={S.selectPlatform}
            >
              <Button
                type="button"
                size="sm"
                variant={addPlatform === "youtube" ? "primary" : "secondary"}
                onClick={() => {
                  setAddPlatform("youtube");
                  setTelegramError(null);
                  setXError(null);
                  setTikTokError(null);
                  onAddChannel?.("clear-error");
                }}
              >
                {S.platformYouTube}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={addPlatform === "telegram" ? "primary" : "secondary"}
                onClick={() => {
                  setAddPlatform("telegram");
                  setTelegramError(null);
                  setXError(null);
                  setTikTokError(null);
                  onAddChannel?.("clear-error");
                }}
              >
                {S.platformTelegram}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={addPlatform === "x" ? "primary" : "secondary"}
                onClick={() => {
                  setAddPlatform("x");
                  setTelegramError(null);
                  setXError(null);
                  setTikTokError(null);
                  onAddChannel?.("clear-error");
                }}
              >
                {S.platformX}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={addPlatform === "tiktok" ? "primary" : "secondary"}
                onClick={() => {
                  setAddPlatform("tiktok");
                  setTelegramError(null);
                  setXError(null);
                  setTikTokError(null);
                  onAddChannel?.("clear-error");
                }}
              >
                {S.platformTikTok}
              </Button>
            </div>

            {addPlatform === "youtube" ? (
              <>
                <p>{S.addChannelLead}</p>
                <form
                  className="db-ws-rename"
                  data-testid={`addchannel-form-${workspace.id}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    onAddChannel?.("search", query, undefined, "youtube");
                  }}
                >
                  <label htmlFor={addChannelQueryId}>{S.addChannel}</label>
                  <Input
                    id={addChannelQueryId}
                    name="query"
                    required
                    maxLength={300}
                    placeholder={S.addChannelPlaceholder}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (channelLookupError) onAddChannel?.("clear-error");
                    }}
                    autoFocus
                  />
                  <div className="db-actions">
                    <Button
                      type="submit"
                      disabled={pending || !query.trim()}
                      data-testid={`addchannel-search-${workspace.id}`}
                    >
                      {S.addChannelSearch}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      data-testid={`addchannel-close-${workspace.id}`}
                      onClick={() => {
                        setQuery("");
                        onAddChannel?.("cancel");
                      }}
                    >
                      {S.addChannelCancel}
                    </Button>
                  </div>
                </form>
              </>
            ) : addPlatform === "telegram" ? (
              <>
                <p>{S.addTelegramLead}</p>
                <form
                  className="db-ws-rename"
                  data-testid={`addtelegram-form-${workspace.id}`}
                  onSubmit={handleTelegramSearch}
                >
                  <label htmlFor={addTelegramInputId}>
                    {S.addTelegramChannel}
                  </label>
                  <Input
                    id={addTelegramInputId}
                    name="handle"
                    required
                    maxLength={100}
                    placeholder={S.addTelegramPlaceholder}
                    value={telegramHandle}
                    onChange={(e) => {
                      setTelegramHandle(e.target.value);
                      if (telegramError) setTelegramError(null);
                      if (channelLookupError) onAddChannel?.("clear-error");
                    }}
                    autoFocus
                  />
                  <small
                    className="db-muted"
                    style={{ display: "block", marginTop: "0.25rem" }}
                  >
                    {S.addDirectAvailableDesc}
                  </small>
                  <div className="db-actions">
                    <Button
                      type="submit"
                      disabled={pending || !telegramHandle.trim()}
                      data-testid={`addtelegram-search-${workspace.id}`}
                    >
                      {S.addChannelSearch}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending || !telegramHandle.trim()}
                      data-testid={`addtelegram-submit-${workspace.id}`}
                      onClick={handleTelegramSubmit}
                    >
                      {S.addDirectAvailable}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      data-testid={`addtelegram-close-${workspace.id}`}
                      onClick={() => {
                        setTelegramHandle("");
                        setTelegramError(null);
                        onAddChannel?.("cancel");
                      }}
                    >
                      {S.addChannelCancel}
                    </Button>
                  </div>
                </form>
              </>
            ) : addPlatform === "x" ? (
              <>
                <p>{S.addXLead}</p>
                <form
                  className="db-ws-rename"
                  data-testid={`addx-form-${workspace.id}`}
                  onSubmit={handleXSearch}
                >
                  <label htmlFor={addXInputId}>{S.addXChannel}</label>
                  <Input
                    id={addXInputId}
                    name="handle"
                    required
                    maxLength={100}
                    placeholder={S.addXPlaceholder}
                    value={xHandle}
                    onChange={(e) => {
                      setXHandle(e.target.value);
                      if (xError) setXError(null);
                      if (channelLookupError) onAddChannel?.("clear-error");
                    }}
                    autoFocus
                  />
                  <small
                    className="db-muted"
                    style={{ display: "block", marginTop: "0.25rem" }}
                  >
                    {S.addDirectAvailableDesc}
                  </small>
                  <div className="db-actions">
                    <Button
                      type="submit"
                      disabled={pending || !xHandle.trim()}
                      data-testid={`addx-search-${workspace.id}`}
                    >
                      {S.addChannelSearch}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending || !xHandle.trim()}
                      data-testid={`addx-submit-${workspace.id}`}
                      onClick={handleXSubmit}
                    >
                      {S.addDirectAvailable}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      data-testid={`addx-close-${workspace.id}`}
                      onClick={() => {
                        setXHandle("");
                        setXError(null);
                        onAddChannel?.("cancel");
                      }}
                    >
                      {S.addChannelCancel}
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p>{S.addTikTokLead}</p>
                <form
                  className="db-ws-rename"
                  data-testid={`addtiktok-form-${workspace.id}`}
                  onSubmit={handleTikTokSearch}
                >
                  <label htmlFor={addTikTokInputId}>{S.addTikTokChannel}</label>
                  <Input
                    id={addTikTokInputId}
                    name="handle"
                    required
                    maxLength={100}
                    placeholder={S.addTikTokPlaceholder}
                    value={tikTokHandle}
                    onChange={(e) => {
                      setTikTokHandle(e.target.value);
                      if (tikTokError) setTikTokError(null);
                      if (channelLookupError) onAddChannel?.("clear-error");
                    }}
                    autoFocus
                  />
                  <small
                    className="db-muted"
                    style={{ display: "block", marginTop: "0.25rem" }}
                  >
                    {S.addDirectAvailableDesc}
                  </small>
                  <div className="db-actions">
                    <Button
                      type="submit"
                      disabled={pending || !tikTokHandle.trim()}
                      data-testid={`addtiktok-search-${workspace.id}`}
                    >
                      {S.addChannelSearch}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending || !tikTokHandle.trim()}
                      data-testid={`addtiktok-submit-${workspace.id}`}
                      onClick={handleTikTokSubmit}
                    >
                      {S.addDirectAvailable}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      data-testid={`addtiktok-close-${workspace.id}`}
                      onClick={() => {
                        setTikTokHandle("");
                        setTikTokError(null);
                        onAddChannel?.("cancel");
                      }}
                    >
                      {S.addChannelCancel}
                    </Button>
                  </div>
                </form>
              </>
            )}

            {/* Validation errors for non-youtube platforms */}
            {addPlatform === "telegram" && telegramError && (
              <p className="db-feedback db-feedback--note" role="status">
                {telegramError}
              </p>
            )}
            {addPlatform === "x" && xError && (
              <p className="db-feedback db-feedback--note" role="status">
                {xError}
              </p>
            )}
            {addPlatform === "tiktok" && tikTokError && (
              <p className="db-feedback db-feedback--note" role="status">
                {tikTokError}
              </p>
            )}

            {/* Backend lookup error */}
            {channelLookupError && (
              <div style={{ marginTop: "0.75rem" }}>
                <p className="db-feedback db-feedback--note" role="status">
                  {channelLookupError}
                </p>
                {addPlatform !== "youtube" && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleDirectAddForCurrentPlatform}
                      data-testid={`addchannel-direct-fallback-${workspace.id}`}
                    >
                      {S.addDirectAvailableAction}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Zero candidates found */}
            {channelCandidates && channelCandidates.length === 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <p className="db-muted">{S.addChannelNone}</p>
                {addPlatform !== "youtube" && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleDirectAddForCurrentPlatform}
                      data-testid={`addchannel-direct-fallback-${workspace.id}`}
                    >
                      {S.addDirectAvailableAction}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Candidates list (works for YouTube, Telegram, X, TikTok) */}
            {channelCandidates && channelCandidates.length > 0 && (
              <ul className="db-candidates" role="list">
                {channelCandidates.map((c) => (
                  <li
                    key={c.external_channel_id}
                    className="db-candidate"
                    data-testid={`addchannel-result-${c.external_channel_id}`}
                  >
                    {c.thumbnail_url ? (
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        style={{
                          borderRadius: "50%",
                          objectFit: "cover",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        className="db-candidate-icon"
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--color-surface-sunken, #f1f5f9)",
                          fontSize: "1.1rem",
                          flexShrink: 0,
                        }}
                      >
                        {c.platform === "telegram"
                          ? "✈️"
                          : c.platform === "x"
                            ? "𝕏"
                            : c.platform === "tiktok"
                              ? "🎵"
                              : "▶️"}
                      </div>
                    )}
                    <span className="db-candidate-name">
                      <bdi>{c.title ?? c.handle ?? c.external_channel_id}</bdi>
                      {c.handle && (
                        <small>
                          <bdi>{c.handle}</bdi>
                        </small>
                      )}
                    </span>
                    {c.platform && c.platform !== "youtube" && (
                      <span
                        className="ui-badge ui-badge--neutral"
                        style={{ marginInlineEnd: "0.5rem" }}
                      >
                        {c.platform === "telegram"
                          ? S.platformTelegram
                          : c.platform === "x"
                            ? S.platformX
                            : c.platform === "tiktok"
                              ? S.platformTikTok
                              : c.platform}
                      </span>
                    )}
                    <Button
                      size="sm"
                      disabled={pending}
                      data-testid={`addchannel-add-${c.external_channel_id}`}
                      onClick={() => onAddChannel?.("add", undefined, c)}
                    >
                      {S.addChannelAdd}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {/* The two questions, asked in a dialog. The page holds the "asking"
            state; every way out of the dialog reports `keep`, the same step
            the inline block's keep button reported. */}
        {(connected || hasPublicChannel) && (
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
        <ShareWorkspaceDialog
          open={shareOpen}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          onClose={() => setShareOpen(false)}
        />
      </li>
    </Card>
  );
}
