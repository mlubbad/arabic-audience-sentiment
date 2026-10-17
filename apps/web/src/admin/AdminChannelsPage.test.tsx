// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { AdminConsoleChannel } from "@sentiment/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "../strings/ar";
import * as adminRead from "./adminRead";
import { AdminChannelsPage } from "./AdminChannelsPage";
import { readTrail } from "./adminTrail";

vi.mock("./adminRead");
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AdminShell")>();
  return {
    ...actual,
    AdminPageHead: ({ title }: { title: string }) => <h1>{title}</h1>,
    useAdminShell: () => ({
      admin: true,
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
  };
});

const WS = "00000000-0000-4000-8000-00000000000";
const row = (
  i: number,
  over: Partial<AdminConsoleChannel>,
): AdminConsoleChannel => ({
  id: `10000000-0000-4000-8000-00000000000${i}`,
  workspace_id: `${WS}${i}`,
  workspace_name: `ws ${i}`,
  mine: true,
  owner_email: "owner@example.com",
  external_channel_id: `UCAAAAAAAAAAAAAAAAAAAAA${i}`,
  title: `Channel ${i}`,
  handle: null,
  state: "healthy",
  last_ok_at: "2026-10-09T06:00:00+00:00",
  last_error: null,
  last_run_at: null,
  catalogued_at: "2026-10-08T06:00:00+00:00",
  videos: 100,
  selected: 20,
  comments: 1000 * i,
  analysed: 900,
  auto_initial: 20,
  auto_daily: 5,
  ...over,
});
const ROWS = [
  row(1, { title: "Healthy one" }),
  row(2, {
    title: "Failing one",
    state: "failing",
    last_error: "quota_exceeded",
    last_ok_at: null,
  }),
  row(3, {
    title: "Customer shop",
    mine: false,
    owner_email: "customer@example.com",
    auto_initial: null,
    auto_daily: null,
  }),
];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function mount(path = "/admin/channels") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AdminChannelsPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const names = () =>
  within(screen.getByTestId("admin-channels"))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("AdminChannelsPage (channels console)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminChannelsConsole).mockResolvedValue(ROWS);
  });

  it("lists every channel, trouble first, with its state, error and counts", async () => {
    mount();
    await screen.findByTestId("admin-channels");
    expect(names()).toEqual(["Failing one", "Customer shop", "Healthy one"]);
    const failing = screen.getByTestId(`admin-console-row-${ROWS[1]!.id}`);
    expect(failing).toHaveTextContent(ar.adminChannelStates.failing!);
    expect(failing).toHaveTextContent("quota_exceeded");
    expect(failing).toHaveTextContent(ar.adminHomeNever);
    expect(
      screen.getByTestId(`admin-console-row-${ROWS[2]!.id}`),
    ).toHaveTextContent("customer@example.com");
    expect(screen.getByText(ar.adminConsoleCount(3, 3))).toBeInTheDocument();
  });

  it("on a phone each channel is a card carrying its state, counts and last success (review finding 13)", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 640px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      mount();
      const list = await screen.findByTestId("admin-channels");
      expect(list.tagName).toBe("DIV");
      expect(within(list).queryByRole("table")).toBeNull();
      expect(names()).toEqual(["Failing one", "Customer shop", "Healthy one"]);
      const failing = screen.getByTestId(`admin-console-row-${ROWS[1]!.id}`);
      expect(failing).toHaveTextContent(ar.adminChannelStates.failing!);
      expect(failing).toHaveTextContent("quota_exceeded");
      expect(failing).toHaveTextContent(ar.adminHomeNever);
      expect(failing).toHaveTextContent("100 · 20");
      expect(failing).toHaveTextContent("2,000");
      const healthy = screen.getByTestId(`admin-console-row-${ROWS[0]!.id}`);
      expect(healthy).toHaveTextContent("2026-10-09 06:00");
      // The selection works the same way: one box per card, one for all.
      await userEvent.click(
        within(list).getByRole("checkbox", { name: ar.adminBulkSelectAll }),
      );
      expect(
        within(list)
          .getAllByRole("checkbox")
          .every((b) => b.getAttribute("aria-checked") === "true"),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens on the state the home linked to, and a chip changes the address", async () => {
    mount("/admin/channels?state=failing");
    await screen.findByTestId("admin-channels");
    expect(names()).toEqual(["Failing one"]);
    expect(screen.getByTestId("admin-console-state-failing")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByTestId("admin-console-state-healthy"));
    expect(names()).toEqual(["Customer shop", "Healthy one"]);
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/admin/channels?state=healthy",
    );
  });

  it("narrows to the customers' channels and to a search", async () => {
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.selectOptions(
      screen.getByLabelText(ar.adminConsoleOwnerLabel),
      "customers",
    );
    expect(names()).toEqual(["Customer shop"]);
    await userEvent.selectOptions(
      screen.getByLabelText(ar.adminConsoleOwnerLabel),
      "all",
    );
    await userEvent.type(
      screen.getByRole("searchbox", { name: ar.adminConsoleSearch }),
      "healthy",
    );
    expect(names()).toEqual(["Healthy one"]);
  });

  it("says so when nothing matches", async () => {
    mount("/admin/channels?q=nothing-like-this");
    expect(await screen.findByText(ar.adminConsoleEmpty)).toBeInTheDocument();
  });

  it("entering a workspace keeps the list as shown and the way back, for the trail on its pages", async () => {
    window.sessionStorage.clear();
    mount("/admin/channels?owner=mine");
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminConsoleOpen("Failing one") }),
    );
    const panel = await screen.findByTestId("admin-console-panel");
    await userEvent.click(
      within(panel).getByRole("link", { name: ar.adminHomeOpenWorkspace }),
    );
    expect(readTrail()).toEqual({
      back: "/admin/channels?owner=mine",
      items: [
        { workspace_id: ROWS[1]!.workspace_id, name: "Failing one" },
        { workspace_id: ROWS[0]!.workspace_id, name: "Healthy one" },
      ],
    });
  });

  it("opens a channel's details beside the list, and walks to the next one", async () => {
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("button", {
        name: ar.adminConsoleOpen("Failing one"),
      }),
    );
    const panel = await screen.findByTestId("admin-console-panel");
    expect(panel).toHaveTextContent("Failing one");
    expect(panel).toHaveTextContent(ar.adminConsoleAutoValue(20, 5));
    expect(panel).toHaveTextContent(ar.adminConsolePosition(1, 3));
    expect(
      within(panel).getByRole("link", { name: ar.adminHomeOpenWorkspace }),
    ).toHaveAttribute("href", `/dashboard?ws=${ROWS[1]!.workspace_id}`);
    expect(
      within(panel).getByRole("button", { name: ar.adminConsolePrev }),
    ).toBeDisabled();

    await userEvent.click(
      within(panel).getByRole("button", { name: ar.adminConsoleNext }),
    );
    expect(panel).toHaveTextContent("Customer shop");
    expect(panel).toHaveTextContent(ar.adminConsoleAutoNone);
    expect(panel).toHaveTextContent("customer@example.com");
  });

  it("pauses a channel only after a confirming press, and says so", async () => {
    vi.mocked(adminRead.setChannelsPaused).mockResolvedValue({
      changed: 1,
      cancelled_jobs: 1,
    });
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminConsoleOpen("Healthy one") }),
    );
    const panel = await screen.findByTestId("admin-console-pause");
    await userEvent.click(
      within(panel).getByRole("button", { name: ar.adminConsolePause }),
    );
    expect(adminRead.setChannelsPaused).not.toHaveBeenCalled();
    await userEvent.click(
      within(panel).getByRole("button", { name: ar.adminConsolePauseConfirm }),
    );
    expect(adminRead.setChannelsPaused).toHaveBeenCalledWith(
      [ROWS[0]!.id],
      true,
    );
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      ar.adminConsolePausedDone,
    );
  });

  it("resumes a paused channel with one press, and names a refusal", async () => {
    vi.mocked(adminRead.readAdminChannelsConsole).mockResolvedValue([
      { ...ROWS[0]!, state: "paused" },
    ]);
    vi.mocked(adminRead.setChannelsPaused).mockRejectedValueOnce({
      message: "forbidden",
    });
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminConsoleOpen("Healthy one") }),
    );
    const panel = await screen.findByTestId("admin-console-pause");
    await userEvent.click(
      within(panel).getByRole("button", { name: ar.adminConsoleResume }),
    );
    expect(adminRead.setChannelsPaused).toHaveBeenCalledWith(
      [ROWS[0]!.id],
      false,
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      ar.adminConsolePauseFailed,
    );
  });

  it("selects channels, collects them in one request, and reports what was left out", async () => {
    vi.mocked(adminRead.requestChannelWork).mockResolvedValue({
      queued: 1,
      skipped: 1,
    });
    mount();
    await screen.findByTestId("admin-channels");
    expect(screen.queryByTestId("admin-bulk")).toBeNull();
    await userEvent.click(
      screen.getByRole("checkbox", { name: ar.adminBulkSelect("Healthy one") }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: ar.adminBulkSelect("Failing one") }),
    );
    const bar = screen.getByTestId("admin-bulk");
    expect(bar).toHaveTextContent(ar.adminBulkSelected(2));
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkCollect }),
    );
    expect(adminRead.requestChannelWork).toHaveBeenCalledWith(
      [ROWS[0]!.id, ROWS[1]!.id],
      "collect",
    );
    expect(await within(bar).findByRole("status")).toHaveTextContent(
      ar.adminBulkQueued(1, 1),
    );
  });

  it("selects every channel shown, and pauses them only after a confirming press", async () => {
    vi.mocked(adminRead.setChannelsPaused).mockResolvedValue({
      changed: 2,
      cancelled_jobs: 3,
    });
    mount("/admin/channels?owner=mine");
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("checkbox", { name: ar.adminBulkSelectAll }),
    );
    const bar = screen.getByTestId("admin-bulk");
    expect(bar).toHaveTextContent(ar.adminBulkSelected(2));
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkPause }),
    );
    expect(adminRead.setChannelsPaused).not.toHaveBeenCalled();
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkPauseConfirm(2) }),
    );
    expect(adminRead.setChannelsPaused).toHaveBeenCalledWith(
      expect.arrayContaining([ROWS[0]!.id, ROWS[1]!.id]),
      true,
    );
    expect(await within(bar).findByRole("status")).toHaveTextContent(
      ar.adminBulkPaused(2, 3),
    );
  });

  it("sets the automatic selection numbers, and refuses numbers out of range", async () => {
    vi.mocked(adminRead.setAutoSelection).mockResolvedValue({ changed: 1 });
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: ar.adminBulkSelect("Customer shop"),
      }),
    );
    const bar = screen.getByTestId("admin-bulk");
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkAuto }),
    );
    const initial = within(bar).getByLabelText(ar.adminBulkAutoInitial);
    await userEvent.clear(initial);
    await userEvent.type(initial, "500");
    expect(
      within(bar).getByRole("button", { name: ar.adminBulkAutoApply }),
    ).toBeDisabled();
    await userEvent.clear(initial);
    await userEvent.type(initial, "10");
    const daily = within(bar).getByLabelText(ar.adminBulkAutoDaily);
    await userEvent.clear(daily);
    await userEvent.type(daily, "2");
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkAutoApply }),
    );
    expect(adminRead.setAutoSelection).toHaveBeenCalledWith(
      [ROWS[2]!.id],
      10,
      2,
    );
    expect(await within(bar).findByRole("status")).toHaveTextContent(
      ar.adminBulkAutoDone(1),
    );
  });

  it("names a refused bulk action", async () => {
    vi.mocked(adminRead.requestChannelWork).mockRejectedValue({
      message: "forbidden",
    });
    mount();
    await screen.findByTestId("admin-channels");
    await userEvent.click(
      screen.getByRole("checkbox", { name: ar.adminBulkSelect("Healthy one") }),
    );
    const bar = screen.getByTestId("admin-bulk");
    await userEvent.click(
      within(bar).getByRole("button", { name: ar.adminBulkCatalogue }),
    );
    expect(await within(bar).findByRole("alert")).toHaveTextContent(
      ar.adminBulkFailed,
    );
  });
});
