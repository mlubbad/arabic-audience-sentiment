// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Plan } from "@sentiment/contracts";
import { EditPlanLimitsDialog, parseLimit } from "./EditPlanLimitsDialog";
import * as adminRead from "./adminRead";

vi.mock("./adminRead", () => ({
  updatePlanLimits: vi.fn(),
}));

const mockPlan: Plan = {
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
};

describe("EditPlanLimitsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders plan title, key, and all current limits", () => {
    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/creator/)).toBeInTheDocument();
    expect(screen.getByTestId("input-plan-channels")).toHaveValue(3);
    expect(screen.getByTestId("input-plan-analysis-units")).toHaveValue(50000);
    expect(screen.getByTestId("input-plan-backfill-units")).toHaveValue(40000);
    expect(screen.getByTestId("input-plan-historical-days")).toHaveValue(30);
    expect(screen.getByTestId("input-plan-topic-units")).toHaveValue(1000);
    expect(screen.getByTestId("input-plan-members")).toHaveValue(2);
    expect(screen.getByTestId("input-plan-workspaces")).toHaveValue(1);
    expect(screen.getByTestId("checkbox-plan-public")).not.toBeChecked();
  });

  it("submits updated limits successfully with all dynamic fields", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    vi.mocked(adminRead.updatePlanLimits).mockResolvedValueOnce({
      ok: true,
      plan: mockPlan,
    });

    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const backfillInput = screen.getByTestId("input-plan-backfill-units");
    await user.clear(backfillInput);
    await user.type(backfillInput, "80000");

    const daysInput = screen.getByTestId("input-plan-historical-days");
    await user.clear(daysInput);
    await user.type(daysInput, "60");

    const topicInput = screen.getByTestId("input-plan-topic-units");
    await user.clear(topicInput);
    await user.type(topicInput, "5000");

    const saveBtn = screen.getByTestId("btn-save-plan-limits");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(adminRead.updatePlanLimits).toHaveBeenCalledWith(
        "creator",
        expect.objectContaining({
          channels: 3,
          channels_limit: 3,
          analysis_units: 50000,
          backfill_units: 80000,
          historical_days_limit: 60,
          topic_units: 5000,
          members: 2,
          members_limit: 2,
          workspaces: 1,
          workspaces_limit: 1,
          allow_public_channels: false,
        }),
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("sets a limit to -1 when clicking the unlimited checkbox", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    vi.mocked(adminRead.updatePlanLimits).mockResolvedValueOnce({
      ok: true,
      plan: mockPlan,
    });

    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const unlHistoricalCheckbox = screen.getByTestId(
      "checkbox-unlimited-historical-days",
    );
    expect(unlHistoricalCheckbox).not.toBeChecked();

    await user.click(unlHistoricalCheckbox);
    expect(screen.getByTestId("input-plan-historical-days")).toHaveValue(-1);

    const saveBtn = screen.getByTestId("btn-save-plan-limits");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(adminRead.updatePlanLimits).toHaveBeenCalledWith(
        "creator",
        expect.objectContaining({
          historical_days_limit: -1,
        }),
      );
    });
  });

  it("displays error message when update fails", async () => {
    const user = userEvent.setup();
    vi.mocked(adminRead.updatePlanLimits).mockRejectedValueOnce(
      new Error("Database error updating plan"),
    );

    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const saveBtn = screen.getByTestId("btn-save-plan-limits");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Database error updating plan"),
      ).toBeInTheDocument();
    });
  });

  it("never saves a cleared field as 0", async () => {
    const user = userEvent.setup();
    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    const input = screen.getByTestId("input-plan-members");
    await user.clear(input);
    // The field stays empty instead of snapping to 0.
    expect(input).toHaveValue(null);
    await user.click(screen.getByTestId("btn-save-plan-limits"));
    expect(adminRead.updatePlanLimits).not.toHaveBeenCalled();
  });

  it("refuses a fractional or below -1 value with a message and no save", async () => {
    const user = userEvent.setup();
    render(
      <EditPlanLimitsDialog
        plan={mockPlan}
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    const input = screen.getByTestId("input-plan-channels");
    await user.clear(input);
    await user.type(input, "-2");
    // The browser's own min/step check blocks this already; submit directly to
    // prove the dialog's check holds even where that one is bypassed.
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(adminRead.updatePlanLimits).not.toHaveBeenCalled();
  });
});

describe("parseLimit", () => {
  it("accepts whole numbers from -1 up", () => {
    expect(parseLimit("-1")).toBe(-1);
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit(" 25 ")).toBe(25);
  });
  it("rejects blank, fractional, below -1 and non-numeric input", () => {
    for (const raw of ["", "  ", "1.5", "-2", "abc", "1e3"])
      expect(parseLimit(raw)).toBeNull();
  });
});
