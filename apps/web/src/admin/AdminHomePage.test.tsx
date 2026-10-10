// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type {
  AdminConsoleOverview,
  AdminDailyDigest,
} from "@sentiment/contracts";
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
    paused: 2,
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

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const states = {
  paused: 0,
  cataloguing: 0,
  collecting: 0,
  failing: 1,
  new: 0,
  waiting: 0,
  stale: 2,
  healthy: 90,
};
const snapshot = (
  day: string,
  failing: { id: string; title: string; error: string }[],
  comments: number,
  analysed: number,
) => ({
  day,
  recorded_at: `${day}T03:53:00+00:00`,
  body: {
    states,
    failing: failing.map((f) => ({
      channel_id: f.id,
      title: f.title,
      handle: null,
      error_code: f.error,
    })),
    comments,
    analysed,
    failed_runs: 3,
    imported: 0,
    movers: [{ channel_id: A, title: "Mover", handle: null, change: -12.5 }],
  },
});
// Yesterday Old Fail failed; this morning New Fail does instead.
const DIGEST: AdminDailyDigest = {
  latest: snapshot(
    "2026-10-10",
    [{ id: B, title: "New Fail", error: "quota_exceeded" }],
    141000,
    70500,
  ),
  previous: snapshot(
    "2026-10-09",
    [{ id: A, title: "Old Fail", error: "rate_limit_exceeded" }],
    140000,
    70000,
  ),
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
    vi.mocked(adminRead.readAdminDailyDigest).mockResolvedValue(DIGEST);
  });

  it("sums up the morning against the day before: new failures, recoveries, what was collected", async () => {
    mount();
    const card = await screen.findByTestId("admin-digest");
    expect(card).toHaveTextContent(ar.adminDigestRecorded("2026-10-10 03:53"));
    expect(within(card).getByTestId("admin-digest-new")).toHaveTextContent(
      "New Fail",
    );
    expect(within(card).getByTestId("admin-digest-new")).toHaveTextContent(
      "quota_exceeded",
    );
    expect(
      within(card).getByTestId("admin-digest-recovered"),
    ).toHaveTextContent("Old Fail");
    expect(card).toHaveTextContent("1,000");
    expect(card).toHaveTextContent("500");
    expect(within(card).getByTestId("admin-digest-movers")).toHaveTextContent(
      ar.adminComparePoints(-12.5),
    );
  });

  it("on the first snapshot lists what fails now and says when the comparison starts", async () => {
    vi.mocked(adminRead.readAdminDailyDigest).mockResolvedValue({
      latest: DIGEST.latest,
      previous: null,
    });
    mount();
    const card = await screen.findByTestId("admin-digest");
    expect(card).toHaveTextContent(ar.adminDigestFirst("2026-10-10 03:53"));
    expect(within(card).getByTestId("admin-digest-failing")).toHaveTextContent(
      "New Fail",
    );
    expect(within(card).queryByText(ar.adminDigestCollected)).toBeNull();
  });

  it("a summary that cannot be read never hides the rest of the page", async () => {
    vi.mocked(adminRead.readAdminDailyDigest).mockRejectedValue(
      new Error("down"),
    );
    mount();
    expect(await screen.findByTestId("admin-home")).toBeInTheDocument();
    expect(
      await screen.findByText(ar.adminDigestUnavailable),
    ).toBeInTheDocument();
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
    expect(rows.at(-2)).toHaveTextContent(ar.adminChannelStates.healthy!);
    expect(rows.at(-2)).toHaveTextContent("90");
    // Paused last: set aside on purpose, not trouble.
    expect(rows.at(-1)).toHaveTextContent(ar.adminChannelStates.paused!);
    expect(rows.at(-1)).toHaveTextContent("2");
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
    expect(adminRead.readAdminDailyDigest).not.toHaveBeenCalled();
    expect(screen.queryByTestId("admin-home")).toBeNull();
  });
});
