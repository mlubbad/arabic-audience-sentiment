// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminOpsPage } from "./AdminOpsPage";
import { ar } from "../strings/ar";

vi.mock("./AdminShell", () => ({
  useAdminShell: () => ({ admin: true, shell: (body: unknown) => body }),
  AdminPageHead: () => null,
}));
vi.mock("./adminRead", () => ({
  readAdminOps: vi.fn(async () => ({
    workspaces: 4,
    channels: 2,
    comments_7d: 120,
    worker_fresh: true,
    worker_last_seen: "2026-10-17T08:00:00+00:00",
    jobs_open: 1,
    sync_runs_7d: 9,
    sync_failed_7d: 1,
    sync_partial_7d: 3,
    failed_runs: [],
  })),
}));

describe("AdminOpsPage", () => {
  it("counts failed syncs apart from partial ones, and says the week's comments are the ones collected", async () => {
    // Owner console review, 2026-10-13, findings 9 and 11.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminOpsPage />
      </QueryClientProvider>,
    );
    const metrics = await screen.findByTestId("admin-ops-metrics");
    const metric = (label: string) =>
      within(metrics).getByText(label).closest(".admin-metric");
    expect(metric(ar.adminOpsFailed7d)).toHaveTextContent("1");
    expect(metric(ar.adminOpsPartial7d)).toHaveTextContent("3");
    expect(metric(ar.adminOpsComments7d)).toHaveTextContent("120");
  });
});
