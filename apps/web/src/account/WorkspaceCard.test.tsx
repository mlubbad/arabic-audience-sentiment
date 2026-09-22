// @vitest-environment jsdom
/**
 * One workspace on the account page, driven: what each door hands back
 * through its step callback, which doors are offered for which channel
 * state, and the two confirmations that moved from an inline block into a
 * dialog. No page, no server — the card's contract is the `step` it calls
 * back with, and `Account.tsx`'s handlers depend on nothing else.
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ar } from "../strings/ar";
import type { ChannelCandidate } from "@sentiment/contracts";
import { WorkspaceCard, type ChannelRow } from "./WorkspaceCard";

const W = "00000000-0000-4000-8000-0000000000a2";

const connected: ChannelRow = {
  workspace_id: W,
  channel_id: "00000000-0000-4000-8000-0000000000e2",
  status: "connected",
  external_channel_id: "UCxxxxxxxxxxxxxxxxxxxxxx",
  handle: "@reem.kitchen",
  title: "مطبخ ريم",
};

type Props = Parameters<typeof WorkspaceCard>[0];

/** The card is the outer `li`; the setup path inside it is a list too, so
 *  the role query would find four. */
const card = () => document.querySelector("ul > li") as HTMLElement;

function mount(
  over: Partial<Props> = {},
  customRerender?: (ui: React.ReactElement) => void,
) {
  const props: Props = {
    workspace: { id: W, name: "مطبخ ريم" },
    hasClient: true,
    channel: null,
    latestJob: null,
    pending: false,
    feedback: null,
    allowPublicChannels: true,
    onConnect: vi.fn(),
    ...over,
  };
  const ui = (
    <MemoryRouter initialEntries={["/account"]}>
      <ul>
        <WorkspaceCard {...props} />
      </ul>
    </MemoryRouter>
  );
  if (customRerender) {
    customRerender(ui);
    return { ...props, unmount: () => {}, rerender: customRerender };
  }
  const result = render(ui);
  return { ...props, unmount: result.unmount, rerender: result.rerender };
}

describe("WorkspaceCard", () => {
  it("is a card as a list item, named by its heading, with the setup path inside", () => {
    mount();
    const li = card();
    expect(li).toHaveClass("ui-card");
    expect(within(li).getByRole("heading", { level: 3 })).toHaveTextContent(
      "مطبخ ريم",
    );
    expect(within(li).getByTestId(`setup-${W}`)).toBeInTheDocument();
  });

  describe("rename", () => {
    it("the door opens the form", async () => {
      const onRename = vi.fn();
      mount({ onRename });
      await userEvent.click(screen.getByTestId(`rename-${W}`));
      expect(onRename).toHaveBeenCalledWith("open");
    });

    it("the open form is prefilled, focused, and submits the typed name", async () => {
      const onRename = vi.fn();
      mount({ onRename, renaming: true });
      const form = screen.getByTestId(`rename-form-${W}`);
      const field = within(form).getByLabelText(ar.workspaceNameLabel);
      expect(field).toHaveValue("مطبخ ريم");
      expect(field).toHaveFocus();
      expect(screen.queryByTestId(`rename-${W}`)).not.toBeInTheDocument();
      await userEvent.clear(field);
      await userEvent.type(field, "مطبخ ريم الجديد");
      await userEvent.click(
        within(form).getByRole("button", { name: ar.renameSave }),
      );
      expect(onRename).toHaveBeenCalledWith("save", "مطبخ ريم الجديد");
    });

    it("cancel closes without a name", async () => {
      const onRename = vi.fn();
      mount({ onRename, renaming: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.renameCancel }),
      );
      expect(onRename).toHaveBeenCalledWith("cancel");
      expect(onRename).not.toHaveBeenCalledWith("save", expect.anything());
    });
  });

  describe("share", () => {
    it("the share door opens the share workspace dialog", async () => {
      mount();
      const shareBtn = screen.getByTestId(`share-${W}`);
      expect(shareBtn).toHaveTextContent(ar.shareWorkspace);
      await userEvent.click(shareBtn);
      expect(screen.getByTestId(`share-dialog-${W}`)).toBeInTheDocument();
    });
  });

  describe("the channel line", () => {
    it("names a connected channel by its title inside <bdi>", () => {
      mount({ channel: connected });
      const line = screen.getByTestId(`channel-${W}`);
      expect(line).toHaveTextContent(ar.channelConnected);
      const name = line.querySelector("bdi");
      expect(name).not.toBeNull();
      expect(name).toHaveTextContent("مطبخ ريم");
    });

    it("falls back to the handle, then to the labelled id", () => {
      mount({ channel: { ...connected, title: null } });
      expect(
        screen.getByTestId(`channel-${W}`).querySelector("bdi"),
      ).toHaveTextContent("@reem.kitchen");
    });

    it("labels a bare id as an id rather than printing it as a name", () => {
      mount({ channel: { ...connected, title: null, handle: null } });
      const line = screen.getByTestId(`channel-${W}`);
      expect(line.querySelector("bdi")).toBeNull();
      expect(line).toHaveTextContent(ar.channelIdLabel);
      expect(line.querySelector("code")).toHaveTextContent(
        "UCxxxxxxxxxxxxxxxxxxxxxx",
      );
    });

    it("says what a seeded public channel is", () => {
      mount({ channel: { ...connected, status: "public_unverified" } });
      expect(screen.getByTestId(`channel-${W}`)).toHaveTextContent(
        ar.channelSeeded,
      );
    });

    it("says what a broken one needs", () => {
      mount({ channel: { ...connected, status: "reconnect_required" } });
      expect(screen.getByTestId(`channel-${W}`)).toHaveTextContent(
        ar.channelNeedsRelink("reconnect_required"),
      );
    });

    it("says there is no channel, on the same test id, when none is attached", () => {
      mount({ channel: null });
      expect(screen.getByTestId(`channel-${W}`)).toHaveTextContent(
        ar.channelNone,
      );
    });
  });

  describe("doors", () => {
    it("connected: the catalogue link, disconnect, no connect and no relink", () => {
      mount({ channel: connected, onDisconnect: vi.fn() });
      const sync = screen.getByTestId(`sync-${W}`);
      expect(sync.tagName).toBe("A");
      expect(sync).toHaveAttribute("href", `/sync?ws=${W}`);
      expect(sync).toHaveTextContent(ar.chooseVideos);
      expect(screen.getByTestId(`disconnect-${W}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`connect-${W}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`relink-${W}`)).not.toBeInTheDocument();
    });

    it("connected without a stored name: the relink door, beside the catalogue link", () => {
      mount({ channel: { ...connected, title: null, handle: null } });
      expect(screen.getByTestId(`relink-${W}`)).toHaveTextContent(
        ar.relinkForName,
      );
      expect(screen.getByTestId(`sync-${W}`)).toBeInTheDocument();
    });

    it("no channel: connect, no sync, no disconnect, no relink", () => {
      mount({ channel: null, onDisconnect: vi.fn() });
      expect(screen.getByTestId(`connect-${W}`)).toHaveTextContent(
        ar.connectChannel,
      );
      expect(screen.queryByTestId(`sync-${W}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`disconnect-${W}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`relink-${W}`)).not.toBeInTheDocument();
    });

    it("public channel: sync and disconnect doors shown, but never connect door", () => {
      mount({
        channel: { ...connected, status: "public_unverified" },
        onDisconnect: vi.fn(),
      });
      expect(screen.getByTestId(`sync-${W}`)).toBeInTheDocument();
      expect(screen.getByTestId(`disconnect-${W}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`connect-${W}`)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`channel-setup-${W}`),
      ).not.toBeInTheDocument();
    });

    it("no channel: displays unified channel setup explaining owner vs public options", () => {
      const onAddChannel = vi.fn();
      mount({ channel: null, onAddChannel });
      expect(screen.getByTestId(`channel-setup-${W}`)).toBeInTheDocument();
      expect(screen.getByText(ar.channelSetupHeading)).toBeInTheDocument();
      expect(screen.getByText(ar.channelOptionOwnerTitle)).toBeInTheDocument();
      expect(screen.getByText(ar.channelOptionPublicTitle)).toBeInTheDocument();
      expect(screen.getByTestId(`connect-${W}`)).toBeInTheDocument();
      expect(screen.getByTestId(`addchannel-${W}`)).toBeInTheDocument();
    });

    it("a channel that needs relinking gets the connect door, not disconnect", () => {
      mount({
        channel: { ...connected, status: "reconnect_required" },
        onDisconnect: vi.fn(),
      });
      expect(screen.getByTestId(`connect-${W}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`disconnect-${W}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`sync-${W}`)).not.toBeInTheDocument();
    });

    it("without a client there is no connect door at all", () => {
      mount({ hasClient: false, channel: null });
      expect(screen.queryByTestId(`connect-${W}`)).not.toBeInTheDocument();
    });

    it("retire is offered only when a handler is passed", () => {
      mount({ onRetire: undefined });
      expect(screen.queryByTestId(`retire-${W}`)).not.toBeInTheDocument();
    });

    it("every door waits while the card is pending", () => {
      const round1 = mount({
        channel: { ...connected, title: null, handle: null },
        pending: true,
        onDisconnect: vi.fn(),
        onRetire: vi.fn(),
        onRename: vi.fn(),
      });
      for (const id of ["rename", "relink", "disconnect", "retire"])
        expect(screen.getByTestId(`${id}-${W}`)).toBeDisabled();
      round1.unmount();

      // The rename form's own save/cancel, while it is open.
      const round2 = mount({
        pending: true,
        renaming: true,
        onRename: vi.fn(),
      });
      expect(
        screen.getByRole("button", { name: ar.renameSave }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: ar.renameCancel }),
      ).toBeDisabled();
      round2.unmount();

      // The connect door itself, before it has been pressed.
      const round3 = mount({
        channel: null,
        hasClient: true,
        pending: true,
        onConnect: vi.fn(),
      });
      expect(screen.getByTestId(`connect-${W}`)).toBeDisabled();
      round3.unmount();
    });
  });

  describe("connect", () => {
    it("connects directly to Google when the connect door is clicked", async () => {
      const onConnect = vi.fn();
      mount({ channel: null, onConnect });
      await userEvent.click(screen.getByTestId(`connect-${W}`));
      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it("relinks directly to Google when the relink door is clicked", async () => {
      const onConnect = vi.fn();
      mount({
        channel: { ...connected, title: null, handle: null },
        onConnect,
      });
      await userEvent.click(screen.getByTestId(`relink-${W}`));
      expect(onConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnect", () => {
    it("the door asks; the dialog confirms or keeps", async () => {
      const onDisconnect = vi.fn();
      mount({ channel: connected, onDisconnect });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId(`disconnect-${W}`));
      expect(onDisconnect).toHaveBeenCalledWith("ask");
    });

    it("open, the dialog carries the sentence, the confirm id and the keep word", async () => {
      const onDisconnect = vi.fn();
      mount({ channel: connected, onDisconnect, confirmingDisconnect: true });
      const dialog = await screen.findByRole("dialog", {
        name: ar.disconnectChannel,
      });
      expect(dialog).toHaveTextContent(ar.disconnectConfirm);
      expect(dialog).toHaveTextContent("مطبخ ريم");
      await userEvent.click(
        within(dialog).getByTestId(`disconnect-confirm-${W}`),
      );
      expect(onDisconnect).toHaveBeenCalledWith("confirm");
      await userEvent.click(
        within(dialog).getByRole("button", { name: ar.disconnectKeep }),
      );
      expect(onDisconnect).toHaveBeenCalledWith("keep");
    });

    it("the corner close carries the cancel id, and Escape keeps too", async () => {
      const onDisconnect = vi.fn();
      mount({ channel: connected, onDisconnect, confirmingDisconnect: true });
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByTestId(`disconnect-cancel-${W}`));
      expect(onDisconnect).toHaveBeenCalledWith("keep");
      onDisconnect.mockClear();
      await userEvent.keyboard("{Escape}");
      expect(onDisconnect).toHaveBeenCalledWith("keep");
    });

    it("while pending, the dialog's buttons wait and it refuses to close", async () => {
      const onDisconnect = vi.fn();
      mount({
        channel: connected,
        onDisconnect,
        confirmingDisconnect: true,
        pending: true,
      });
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByTestId(`disconnect-confirm-${W}`),
      ).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: ar.disconnectKeep }),
      ).toBeDisabled();
      await userEvent.keyboard("{Escape}");
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    it("public_unverified channel renders disconnect door and confirm dialog", async () => {
      const publicChannel: ChannelRow = {
        workspace_id: W,
        channel_id: "e4047855-7a05-4ca9-9194-3c95a5e75455",
        status: "public_unverified",
        external_channel_id: "SkyNewsArabia_B",
        title: "Sky News Arabia",
        handle: "SkyNewsArabia_B",
        platform: "telegram",
      };
      const onDisconnect = vi.fn();
      mount({ channel: publicChannel, onDisconnect });
      expect(screen.getByTestId(`disconnect-${W}`)).toBeInTheDocument();
      await userEvent.click(screen.getByTestId(`disconnect-${W}`));
      expect(onDisconnect).toHaveBeenCalledWith("ask");

      mount({
        channel: publicChannel,
        onDisconnect,
        confirmingDisconnect: true,
      });
      const dialog = await screen.findByRole("dialog", {
        name: ar.disconnectChannel,
      });
      expect(dialog).toBeInTheDocument();
    });
  });

  describe("retire", () => {
    it("the door asks; the dialog confirms in the danger tone, or keeps", async () => {
      const onRetire = vi.fn();
      mount({ channel: null, onRetire });
      const door = screen.getByTestId(`retire-${W}`);
      expect(door).toHaveTextContent(ar.retireWorkspace);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(door);
      expect(onRetire).toHaveBeenCalledWith("ask");
    });

    it("open, the dialog says what stays, and its confirm carries the retire id", async () => {
      const onRetire = vi.fn();
      mount({ channel: null, onRetire, confirmingRetire: true });
      const dialog = await screen.findByRole("dialog", {
        name: ar.retireWorkspace,
      });
      expect(dialog).toHaveTextContent(ar.retireConfirm);
      const confirm = within(dialog).getByTestId(`retire-confirm-${W}`);
      expect(confirm).toHaveClass("ui-btn--danger");
      await userEvent.click(confirm);
      expect(onRetire).toHaveBeenCalledWith("confirm");
      await userEvent.click(
        within(dialog).getByRole("button", { name: ar.retireKeep }),
      );
      expect(onRetire).toHaveBeenCalledWith("keep");
      await userEvent.click(screen.getByTestId(`retire-cancel-${W}`));
      expect(onRetire).toHaveBeenCalledTimes(3);
      expect(onRetire).toHaveBeenLastCalledWith("keep");
    });

    it("focus lands inside the dialog when it opens", async () => {
      mount({ channel: null, onRetire: vi.fn(), confirmingRetire: true });
      const dialog = await screen.findByRole("dialog");
      await waitFor(() =>
        expect(dialog).toContainElement(document.activeElement as HTMLElement),
      );
    });
  });

  it("carries its feedback inside the card, after the doors", () => {
    mount({
      channel: connected,
      feedback: <p data-testid="note">قائم</p>,
    });
    const li = card();
    const note = within(li).getByTestId("note");
    const sync = within(li).getByTestId(`sync-${W}`);
    expect(
      sync.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe("add channel by link or search", () => {
    const candidate = {
      external_channel_id: "UCTPIL6f7yNpK8yc-H3cEtFg",
      handle: "@alaa_jaber_official",
      title: "علاء جابر",
      thumbnail_url: "https://i.ytimg.com/a.jpg",
    };

    it("the door is offered while no channel is named, and not otherwise", () => {
      const onAddChannel = vi.fn();
      const open = mount({ onAddChannel });
      expect(screen.getByTestId(`addchannel-${W}`)).toBeInTheDocument();
      open.unmount();
      // A workspace that already names a channel — public or connected — has
      // no second one to add: the server would refuse.
      const named = mount({ onAddChannel, channel: connected });
      expect(screen.queryByTestId(`addchannel-${W}`)).not.toBeInTheDocument();
      named.unmount();
      mount({ channel: connected });
      expect(screen.queryByTestId(`addchannel-${W}`)).not.toBeInTheDocument();
    });

    it("the form's search hands the typed query back", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      const form = screen.getByTestId(`addchannel-form-${W}`);
      const field = within(form).getByLabelText(ar.addChannel);
      await userEvent.type(field, "youtube.com/@alaa_jaber_official");
      await userEvent.click(
        within(form).getByRole("button", { name: ar.addChannelSearch }),
      );
      expect(onAddChannel).toHaveBeenCalledWith(
        "search",
        "youtube.com/@alaa_jaber_official",
        undefined,
        "youtube",
      );
    });

    it("each candidate carries its own add door", async () => {
      const onAddChannel = vi.fn();
      mount({
        onAddChannel,
        addingChannel: true,
        channelCandidates: [candidate],
      });
      await userEvent.click(
        screen.getByTestId(`addchannel-add-${candidate.external_channel_id}`),
      );
      expect(onAddChannel).toHaveBeenCalledWith("add", undefined, candidate);
    });

    it("an empty answer and a refusal each read as their own sentence", () => {
      mount({
        onAddChannel: vi.fn(),
        addingChannel: true,
        channelCandidates: [],
      });
      expect(screen.getByText(ar.addChannelNone)).toBeInTheDocument();
      mount({
        onAddChannel: vi.fn(),
        addingChannel: true,
        channelLookupError: ar.addChannelFailed,
      });
      expect(screen.getByText(ar.addChannelFailed)).toBeInTheDocument();
    });

    it("typing in the query field clears a displayed lookup error", async () => {
      const onAddChannel = vi.fn();
      mount({
        onAddChannel,
        addingChannel: true,
        channelLookupError: ar.addChannelFailed,
      });
      const form = screen.getByTestId(`addchannel-form-${W}`);
      const field = within(form).getByLabelText(ar.addChannel);
      await userEvent.type(field, "a");
      expect(onAddChannel).toHaveBeenCalledWith("clear-error");
    });

    it("switches to Telegram and adds a channel by handle or URL", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTelegram }),
      );
      const form = screen.getByTestId(`addtelegram-form-${W}`);
      const field = within(form).getByLabelText(ar.addTelegramChannel);
      await userEvent.type(field, "https://t.me/tech_news_arabic");
      await userEvent.click(screen.getByTestId(`addtelegram-submit-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith("add", undefined, {
        external_channel_id: "@tech_news_arabic",
        handle: "@tech_news_arabic",
        title: "@tech_news_arabic",
        thumbnail_url: null,
        platform: "telegram",
      });
    });

    it("validates Telegram handle and shows error for invalid input", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTelegram }),
      );
      const form = screen.getByTestId(`addtelegram-form-${W}`);
      const field = within(form).getByLabelText(ar.addTelegramChannel);
      await userEvent.type(field, "???");
      await userEvent.click(screen.getByTestId(`addtelegram-submit-${W}`));
      expect(screen.getByText(ar.addTelegramInvalidHandle)).toBeInTheDocument();
      expect(onAddChannel).not.toHaveBeenCalledWith(
        "add",
        expect.anything(),
        expect.anything(),
      );
    });

    it("displays Telegram badge on connected Telegram channel", () => {
      mount({
        channel: {
          ...connected,
          platform: "telegram",
          title: "@tech_news_arabic",
        },
      });
      expect(screen.getByText(ar.platformTelegram)).toBeInTheDocument();
    });

    it("switches to X and adds an account by handle or URL", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(screen.getByRole("button", { name: ar.platformX }));
      const form = screen.getByTestId(`addx-form-${W}`);
      const field = within(form).getByLabelText(ar.addXChannel);
      await userEvent.type(field, "https://x.com/aljazeera");
      await userEvent.click(screen.getByTestId(`addx-submit-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith("add", undefined, {
        external_channel_id: "aljazeera",
        handle: "@aljazeera",
        title: "@aljazeera",
        thumbnail_url: null,
        platform: "x",
      });
    });

    it("validates X handle and shows error for invalid input", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(screen.getByRole("button", { name: ar.platformX }));
      const form = screen.getByTestId(`addx-form-${W}`);
      const field = within(form).getByLabelText(ar.addXChannel);
      await userEvent.type(field, "invalid handle with spaces!");
      await userEvent.click(screen.getByTestId(`addx-submit-${W}`));
      expect(screen.getByText(ar.addXInvalidHandle)).toBeInTheDocument();
      expect(onAddChannel).not.toHaveBeenCalledWith(
        "add",
        expect.anything(),
        expect.anything(),
      );
    });

    it("displays X badge on connected X channel", () => {
      mount({
        channel: {
          ...connected,
          platform: "x",
          title: "@aljazeera",
        },
      });
      expect(screen.getByText(ar.platformX)).toBeInTheDocument();
    });

    it("switches to TikTok and adds an account by handle or URL", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTikTok }),
      );
      const form = screen.getByTestId(`addtiktok-form-${W}`);
      const field = within(form).getByLabelText(ar.addTikTokChannel);
      await userEvent.type(field, "https://www.tiktok.com/@khaby.lame");
      await userEvent.click(screen.getByTestId(`addtiktok-submit-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith("add", undefined, {
        external_channel_id: "khaby.lame",
        handle: "@khaby.lame",
        title: "@khaby.lame",
        thumbnail_url: null,
        platform: "tiktok",
      });
    });

    it("validates TikTok handle and shows error for invalid input", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTikTok }),
      );
      const form = screen.getByTestId(`addtiktok-form-${W}`);
      const field = within(form).getByLabelText(ar.addTikTokChannel);
      await userEvent.type(field, "a"); // too short (<2 chars)
      await userEvent.click(screen.getByTestId(`addtiktok-submit-${W}`));
      expect(screen.getByText(ar.addTikTokInvalidHandle)).toBeInTheDocument();
      expect(onAddChannel).not.toHaveBeenCalledWith(
        "add",
        expect.anything(),
        expect.anything(),
      );
    });

    it("displays TikTok badge on connected TikTok channel", () => {
      mount({
        channel: {
          ...connected,
          platform: "tiktok",
          title: "@khaby.lame",
        },
      });
      expect(screen.getByText(ar.platformTikTok)).toBeInTheDocument();
    });

    it("switches to Telegram, searches channel, sees candidate, and adds it", async () => {
      const onAddChannel = vi.fn();
      const telegramCandidate: ChannelCandidate = {
        external_channel_id: "@tech_news_arabic",
        handle: "@tech_news_arabic",
        title: "أخبار التقنية",
        thumbnail_url: "https://example.com/tg.jpg",
        platform: "telegram",
      };
      const { rerender } = mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTelegram }),
      );
      const form = screen.getByTestId(`addtelegram-form-${W}`);
      const field = within(form).getByLabelText(ar.addTelegramChannel);
      await userEvent.type(field, "https://t.me/tech_news_arabic");
      await userEvent.click(screen.getByTestId(`addtelegram-search-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith(
        "search",
        "@tech_news_arabic",
        undefined,
        "telegram",
      );

      mount(
        {
          onAddChannel,
          addingChannel: true,
          channelCandidates: [telegramCandidate],
        },
        rerender,
      );
      expect(screen.getByText("أخبار التقنية")).toBeInTheDocument();
      await userEvent.click(
        screen.getByTestId(
          `addchannel-add-${telegramCandidate.external_channel_id}`,
        ),
      );
      expect(onAddChannel).toHaveBeenCalledWith(
        "add",
        undefined,
        telegramCandidate,
      );
    });

    it("switches to Telegram and shows fallback direct add button on lookup error", async () => {
      const onAddChannel = vi.fn();
      const { rerender } = mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTelegram }),
      );
      const form = screen.getByTestId(`addtelegram-form-${W}`);
      const field = within(form).getByLabelText(ar.addTelegramChannel);
      await userEvent.type(field, "telegram_channel");

      mount(
        {
          onAddChannel,
          addingChannel: true,
          channelLookupError: "حدث خطأ في البحث",
        },
        rerender,
      );
      expect(screen.getByText("حدث خطأ في البحث")).toBeInTheDocument();
      const fallbackBtn = screen.getByTestId(`addchannel-direct-fallback-${W}`);
      expect(fallbackBtn).toBeInTheDocument();
      await userEvent.click(fallbackBtn);
      expect(onAddChannel).toHaveBeenCalledWith("add", undefined, {
        external_channel_id: "@telegram_channel",
        handle: "@telegram_channel",
        title: "@telegram_channel",
        thumbnail_url: null,
        platform: "telegram",
      });
    });

    it("switches to X and searches account before adding", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(screen.getByRole("button", { name: ar.platformX }));
      const form = screen.getByTestId(`addx-form-${W}`);
      const field = within(form).getByLabelText(ar.addXChannel);
      await userEvent.type(field, "https://x.com/aljazeera");
      await userEvent.click(screen.getByTestId(`addx-search-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith(
        "search",
        "aljazeera",
        undefined,
        "x",
      );
    });

    it("switches to TikTok and searches account before adding", async () => {
      const onAddChannel = vi.fn();
      mount({ onAddChannel, addingChannel: true });
      await userEvent.click(
        screen.getByRole("button", { name: ar.platformTikTok }),
      );
      const form = screen.getByTestId(`addtiktok-form-${W}`);
      const field = within(form).getByLabelText(ar.addTikTokChannel);
      await userEvent.type(field, "https://www.tiktok.com/@khaby.lame");
      await userEvent.click(screen.getByTestId(`addtiktok-search-${W}`));
      expect(onAddChannel).toHaveBeenCalledWith(
        "search",
        "khaby.lame",
        undefined,
        "tiktok",
      );
    });
  });

  describe("permission gating for public channels", () => {
    it("hides public channel choice when allowPublicChannels is false", () => {
      mount({ allowPublicChannels: false });
      expect(screen.queryByTestId(`channel-setup-${W}`)).toBeNull();
      expect(screen.queryByTestId(`addchannel-${W}`)).toBeNull();
      expect(screen.getByTestId(`connect-${W}`)).toBeInTheDocument();
    });

    it("displays both choices when allowPublicChannels is true", () => {
      mount({ allowPublicChannels: true, onAddChannel: vi.fn() });
      expect(screen.getByTestId(`channel-setup-${W}`)).toBeInTheDocument();
      expect(screen.getByTestId(`connect-${W}`)).toBeInTheDocument();
      expect(screen.getByTestId(`addchannel-${W}`)).toBeInTheDocument();
    });
  });
});
