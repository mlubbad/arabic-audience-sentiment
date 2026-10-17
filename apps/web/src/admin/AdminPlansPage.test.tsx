// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Plan } from "@sentiment/contracts";
import { AdminPlansPage } from "./AdminPlansPage";
import * as adminRead from "./adminRead";
import { ar } from "../strings/ar";

vi.mock("./AdminShell", () => ({
  useAdminShell: () => ({ admin: true, shell: (body: unknown) => body }),
  AdminPageHead: () => null,
}));
vi.mock("./adminRead", () => ({
  updatePlanPublicChannels: vi.fn(),
  updatePlanLimits: vi.fn(),
}));

const PLAN: Plan = {
  key: "creator",
  title_ar: "صانع المحتوى",
  title_en: "Creator",
  price_monthly_cents: 2900,
  price_yearly_cents: 29000,
  provider_prices: {},
  segment: "individual",
  self_serve: true,
  limits: {
    channels: 3,
    analysis_units: 50000,
    topic_units: 1000,
    insight_reports: 5,
    members: 2,
    workspaces: 1,
    live_interval_minutes: 60,
  },
  backfill_units: 40000,
  historical_days_limit: 30,
  allow_public_channels: false,
};

vi.mock("../planCatalogue", () => ({
  useAdminPlanCatalogue: () => ({
    isPending: false,
    isError: false,
    data: [PLAN],
    refetch: vi.fn(),
  }),
}));

describe("AdminPlansPage", () => {
  it("says the public-channels save failed, and leaves the toggle where the database has it", async () => {
    // Owner console review, 2026-10-13, finding 7: a refused save used to
    // report success and flip the toggle anyway.
    vi.mocked(adminRead.updatePlanPublicChannels).mockRejectedValueOnce(
      Object.assign(new Error("live_unavailable"), { code: "42501" }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminPlansPage />
      </QueryClientProvider>,
    );
    const toggle = screen.getByTestId("toggle-plan-creator");
    expect(toggle).toHaveTextContent(ar.adminPlanPublicChannelsBlocked);
    await userEvent.setup().click(toggle);

    expect(await screen.findByRole("status")).toHaveTextContent(
      `${ar.adminPlanToggleFailed} (42501)`,
    );
    expect(screen.queryByText(ar.adminPlanToggleSuccess)).toBeNull();
    expect(adminRead.updatePlanPublicChannels).toHaveBeenCalledWith(
      "creator",
      true,
    );
    expect(screen.getByTestId("toggle-plan-creator")).toHaveTextContent(
      ar.adminPlanPublicChannelsBlocked,
    );
  });
});
