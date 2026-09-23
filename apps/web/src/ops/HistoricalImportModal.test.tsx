// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsageSummary } from "@sentiment/contracts";
import { HistoricalImportModal } from "./HistoricalImportModal";

const mockRpc = vi.fn();
vi.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const mockPlan: UsageSummary = {
  plan_key: "creator",
  status: "active",
  period_start: "2026-03-01T00:00:00Z",
  period_end: "2026-04-01T00:00:00Z",
  cancel_at_period_end: false,
  billing_interval: "month",
  provider: null,
  budgets: [
    {
      event_type: "historical_backfill",
      allowance: 40000,
      used: 5000,
      granted: 0,
      remaining: 35000,
    },
  ],
  plan: {
    key: "creator",
    title_ar: "خطة صانع المحتوى",
    title_en: "Creator Plan",
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
  },
};

describe("HistoricalImportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders quota remaining and historical days limit", () => {
    render(
      <HistoricalImportModal
        open={true}
        onClose={vi.fn()}
        workspaceId="w_123"
        channelId="c_123"
        plan={mockPlan}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/35,000/)).toBeInTheDocument();
    expect(screen.getAllByText(/30/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("tab-platform-sync")).toBeInTheDocument();
    expect(screen.getByTestId("tab-file-import")).toBeInTheDocument();
  });

  it("submits platform historical sync successfully", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, job_id: "job_hist_1" },
      error: null,
    });

    render(
      <HistoricalImportModal
        open={true}
        onClose={vi.fn()}
        workspaceId="w_123"
        channelId="c_123"
        plan={mockPlan}
        onSuccess={onSuccess}
      />,
    );

    const submitBtn = screen.getByTestId("btn-submit-sync");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("request_historical_platform_sync", {
        w: "w_123",
        p_channel_id: "c_123",
        p_days_back: 30,
        p_max_items: 50,
        p_published_after: null,
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("warns if days back exceeds plan limit", async () => {
    const user = userEvent.setup();

    render(
      <HistoricalImportModal
        open={true}
        onClose={vi.fn()}
        workspaceId="w_123"
        channelId="c_123"
        plan={mockPlan}
        onSuccess={vi.fn()}
      />,
    );

    const daysInput = screen.getByTestId("input-days-back");
    await user.clear(daysInput);
    await user.type(daysInput, "60");

    const submitBtn = screen.getByTestId("btn-submit-sync");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockRpc).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("switches to file tab and allows downloading sample template", async () => {
    const user = userEvent.setup();

    render(
      <HistoricalImportModal
        open={true}
        onClose={vi.fn()}
        workspaceId="w_123"
        channelId="c_123"
        plan={mockPlan}
        onSuccess={vi.fn()}
      />,
    );

    const fileTab = screen.getByTestId("tab-file-import");
    await user.click(fileTab);

    expect(screen.getByTestId("btn-download-template")).toBeInTheDocument();
    expect(screen.getByTestId("input-file-import")).toBeInTheDocument();
  });

  it("handles CSV file upload and submits import successfully", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        posts_count: 1,
        comments_count: 1,
        backfill_units_used: 1,
        backfill_units_remaining: 34999,
      },
      error: null,
    });

    render(
      <HistoricalImportModal
        open={true}
        onClose={vi.fn()}
        workspaceId="w_123"
        channelId="c_123"
        plan={mockPlan}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByTestId("tab-file-import"));

    const csvContent =
      "comment_id,comment_text,author,published_at,video_id,video_title\n" +
      "c1,رائع جدا ومفيد,أحمد,2026-03-01T12:00:00Z,v1,شرح تاريخي";
    const file = new File([csvContent], "test_import.csv", {
      type: "text/csv",
    });

    const fileInput = screen.getByTestId("input-file-import");
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId("btn-submit-file-import")).toBeEnabled();
    });

    await user.click(screen.getByTestId("btn-submit-file-import"));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        "import_historical_records",
        expect.objectContaining({
          w: "w_123",
          p_channel_id: "c_123",
        }),
      );
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
