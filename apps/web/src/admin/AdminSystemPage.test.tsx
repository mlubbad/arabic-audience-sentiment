// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
  AdminAuditEvent,
  AdminBackgroundJobs,
  ServicesHealthReport,
} from "@sentiment/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "../strings/ar";
import * as adminRead from "./adminRead";
import { AdminPageHead } from "./AdminShell";
import { AdminSystemPage } from "./AdminSystemPage";

vi.mock("./adminRead");
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AdminShell")>();
  return {
    ...actual,
    useAdminShell: () => ({
      admin: true,
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
  };
});

const REPORT = {
  overall_status: "degraded",
  checked_at: "2026-10-10T08:00:00Z",
  summary: {
    total: 12,
    healthy: 10,
    degraded: 1,
    down: 1,
    unconfigured: 0,
    not_monitored: 0,
    avg_latency_ms: 40,
  },
  services: [],
} as unknown as ServicesHealthReport;

const event = (i: number): AdminAuditEvent => ({
  id: `20000000-0000-4000-8000-00000000000${i}`,
  workspace_id: null,
  workspace_name: "Platform",
  actor_id: null,
  actor_email: null,
  action: "channel_imported",
  target_type: "channel",
  target_id: null,
  created_at: `2026-10-10T0${i}:00:00+00:00`,
});

// Production on 2026-10-13: the comparison step failing, the reconcile fine.
const JOBS: AdminBackgroundJobs = {
  checked_at: "2026-10-13T02:00:00+00:00",
  cron_available: true,
  jobs: [
    {
      name: "channel-compare-step",
      schedule: "* * * * *",
      active: true,
      last_status: "failed",
      last_started_at: "2026-10-13T01:59:00+00:00",
      last_finished_at: "2026-10-13T02:00:00+00:00",
      last_error: "ERROR:  canceling statement due to statement timeout",
      runs_24h: 60,
      failures_24h: 3,
    },
    {
      name: "reconcile-video-comment-stats-step",
      schedule: "* 2-4 * * *",
      active: true,
      last_status: "succeeded",
      last_started_at: "2026-10-13T02:30:00+00:00",
      last_finished_at: "2026-10-13T02:30:01+00:00",
      last_error: null,
      runs_24h: 30,
      failures_24h: 0,
    },
    {
      name: "some-new-job",
      schedule: "0 * * * *",
      active: true,
      last_status: null,
      last_started_at: null,
      last_finished_at: null,
      last_error: null,
      runs_24h: 0,
      failures_24h: 0,
    },
  ],
  compare: {
    channels: 130,
    counted: 40,
    never_counted: 89,
    waiting: 95,
    failing: 1,
    oldest_counted_at: "2026-10-13T01:00:00+00:00",
    last_error: "ERROR:  canceling statement due to statement timeout",
  },
  stats: { workspaces: 115, reconciled_24h: 30, failing: 0, last_error: null },
};

function mount(path: string, page: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminSystemPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminServicesHealth).mockResolvedValue(REPORT);
    vi.mocked(adminRead.readAdminAudit).mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map(event),
    );
    vi.mocked(adminRead.readAdminBackgroundJobs).mockResolvedValue(JOBS);
  });

  it("shows each scheduled job's last run, a failure with its error, and both recounts", async () => {
    mount("/admin/system", <AdminSystemPage />);
    const failed = await screen.findByTestId("admin-job-channel-compare-step");
    expect(failed).toHaveTextContent(
      ar.adminJobsNames["channel-compare-step"]!,
    );
    expect(failed).toHaveTextContent(ar.adminJobsFailed);
    expect(failed).toHaveTextContent(ar.adminJobsRuns(3, 60));
    expect(failed).toHaveTextContent(
      /canceling statement due to statement timeout/,
    );
    expect(
      screen.getByTestId("admin-job-reconcile-video-comment-stats-step"),
    ).toHaveTextContent(ar.adminJobsOk);
    // A job the console has no name for shows its own.
    expect(screen.getByTestId("admin-job-some-new-job")).toHaveTextContent(
      "some-new-job",
    );
    expect(screen.getByTestId("admin-job-some-new-job")).toHaveTextContent(
      ar.adminJobsNever,
    );
    const compare = screen.getByTestId("admin-jobs-compare");
    expect(compare).toHaveTextContent(ar.adminJobsCompare(40, 130));
    expect(compare).toHaveTextContent(ar.adminJobsNeverCounted(89));
    expect(compare).toHaveTextContent(ar.adminJobsFailing(1));
    expect(screen.getByTestId("admin-jobs-stats")).toHaveTextContent(
      ar.adminJobsStats(30, 115),
    );
  });

  it("says so where scheduled jobs are not available", async () => {
    vi.mocked(adminRead.readAdminBackgroundJobs).mockResolvedValue({
      ...JOBS,
      cron_available: false,
      jobs: [],
    });
    mount("/admin/system", <AdminSystemPage />);
    expect(await screen.findByText(ar.adminJobsUnavailable)).toBeVisible();
  });

  it("leads to each system page, with the services' health and the latest audit entries", async () => {
    mount("/admin/system", <AdminSystemPage />);
    const room = await screen.findByTestId("admin-system");
    for (const [name, to] of [
      [ar.adminTabServices, "/admin/services"],
      [ar.adminTabOps, "/admin/ops"],
      [ar.adminTabPlans, "/admin/plans"],
      [ar.adminTabImport, "/admin/import"],
      [ar.adminTabAudit, "/admin/audit"],
    ] as const)
      expect(
        within(room).getByRole("link", { name: ar.adminSystemOpen(name) }),
      ).toHaveAttribute("href", to);

    const services = await screen.findByTestId("admin-system-services");
    expect(services).toHaveTextContent(ar.adminSystemHealthy(10));
    expect(services).toHaveTextContent(ar.adminSystemDegraded(1));
    expect(services).toHaveTextContent(ar.adminSystemDown(1));
    const audit = await screen.findByTestId("admin-system-audit");
    expect(within(audit).getAllByRole("listitem")).toHaveLength(5);
  });

  it("a read that fails says so on its card and leaves the others", async () => {
    vi.mocked(adminRead.readAdminServicesHealth).mockRejectedValue(
      new Error("down"),
    );
    mount("/admin/system", <AdminSystemPage />);
    expect(await screen.findByText(ar.adminSystemUnread)).toBeVisible();
    expect(await screen.findByTestId("admin-system-audit")).toBeVisible();
  });

  it("the tab strip names «النظام» the current room on a system page, which links back to it", () => {
    mount(
      "/admin/services",
      <AdminPageHead title={ar.adminTabServices} lead="" />,
    );
    const tabs = screen.getByRole("navigation", { name: ar.adminTabsLabel });
    expect(
      within(tabs).getByRole("link", { name: ar.adminTabSystem }),
    ).toHaveClass("admin-tab-active");
    expect(within(tabs).queryByText(ar.adminTabServices)).toBeNull();
    expect(
      screen.getByRole("link", { name: ar.adminSystemBack }),
    ).toHaveAttribute("href", "/admin/system");
  });

  it("a page outside the room has no way back to it and lights its own tab", () => {
    mount("/admin/channels", <AdminPageHead title="x" lead="" />);
    const tabs = screen.getByRole("navigation", { name: ar.adminTabsLabel });
    expect(
      within(tabs).getByRole("link", { name: ar.adminTabSystem }),
    ).not.toHaveClass("admin-tab-active");
    expect(screen.queryByRole("link", { name: ar.adminSystemBack })).toBeNull();
  });
});
