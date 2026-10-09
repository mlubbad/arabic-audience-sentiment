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
});
