// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { AdminConsoleOverview } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { AdminHomePage } from "./AdminHomePage";
import * as adminRead from "./adminRead";

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

const WS = "00000000-0000-4000-8000-000000000003";
const OVERVIEW: AdminConsoleOverview = {
  workspaces: 103,
  users: 12,
  channels: 101,
  states: {
    cataloguing: 4,
    collecting: 2,
    failing: 1,
    new: 0,
    waiting: 3,
    stale: 1,
    healthy: 90,
  },
  funnel: { videos: 25000, selected: 2000, comments: 140000, analysed: 70000 },
  worker: {
    fresh: false,
    last_seen: "2026-10-09T07:00:00+00:00",
    queued: 7,
    running: 1,
  },
  attention: [
    {
      channel_id: "10000000-0000-4000-8000-000000000003",
      workspace_id: WS,
      workspace_name: "بشار عربي",
      title: "بشار عربي – bashar arabi",
      handle: "@BasharIbnArabi",
      state: "failing",
      error_code: "quota_exceeded",
      last_ok_at: null,
      last_run_at: "2026-10-09T06:00:00+00:00",
    },
  ],
  activity: [
    {
      at: "2026-10-09T07:30:00+00:00",
      action: "channel_imported",
      actor_email: "owner@example.com",
      workspace_name: "Shop",
    },
  ],
};

function mount(path = "/admin") {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AdminHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminConsoleOverview).mockResolvedValue(OVERVIEW);
  });

  it("shows the size of the platform and the worker's queue", async () => {
    mount();
    expect(await screen.findByTestId("admin-home")).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText("103")).toBeInTheDocument();
    expect(screen.getAllByText("140,000").length).toBeGreaterThan(0);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(ar.adminHomeWorkerStale)).toBeInTheDocument();
    expect(screen.getByText(ar.adminHomeQueue(7, 1))).toBeInTheDocument();
  });

  it("counts every state, trouble first", async () => {
    mount();
    const states = await screen.findByTestId("admin-home-states");
    const rows = within(states).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(ar.adminChannelStates.failing!);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows.at(-1)).toHaveTextContent(ar.adminChannelStates.healthy!);
    expect(rows.at(-1)).toHaveTextContent("90");
  });

  it("lists what needs the owner, with the error and the way into its workspace", async () => {
    mount();
    const list = await screen.findByTestId("admin-home-attention");
    expect(list).toHaveTextContent("بشار عربي – bashar arabi");
    expect(list).toHaveTextContent("quota_exceeded");
    expect(list).toHaveTextContent(ar.adminHomeNever);
    expect(
      within(list).getByRole("link", { name: ar.adminHomeOpenWorkspace }),
    ).toHaveAttribute("href", `/dashboard?ws=${WS}`);
  });

  it("shows what happened lately in words", async () => {
    mount();
    const feed = await screen.findByTestId("admin-home-activity");
    expect(feed).toHaveTextContent(ar.adminAccountActions.channel_imported!);
    expect(feed).toHaveTextContent(
      ar.adminAccountHistoryBy("owner@example.com"),
    );
  });

  it("says so when nothing needs the owner", async () => {
    vi.mocked(adminRead.readAdminConsoleOverview).mockResolvedValue({
      ...OVERVIEW,
      attention: [],
    });
    mount();
    expect(
      await screen.findByText(ar.adminHomeAttentionEmpty),
    ).toBeInTheDocument();
  });

  it("asks nothing of the server on the demo", () => {
    mount("/admin?demo=1");
    expect(adminRead.readAdminConsoleOverview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("admin-home")).toBeNull();
  });
});
