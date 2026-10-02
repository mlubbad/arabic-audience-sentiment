// @vitest-environment jsdom
/**
 * The account page's plan panel: the pure view against every `WorkspaceState`
 * it can be handed, the live wrapper's wiring to `usePlanUsage`/Paddle, and
 * the demo wrapper's `S.demoExternalNote` press feedback — the one behaviour
 * the brief calls out by name.
 *
 * `PlanPanelView` is exercised directly wherever the branch does not depend
 * on which wrapper feeds it (loading, none chosen, failed, the budgets and
 * doors); `PlanPanel`/`DemoPlanPanel` are exercised for what only they add:
 * `usePlanUsage`/Paddle wiring, the `configuredMode` guard, and the demo
 * reducer's stand-in state.
 */
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Session } from "@supabase/supabase-js";
import type { UsageSummary } from "@sentiment/contracts";
import type { WorkspaceState } from "../workspace";
import { ar } from "../strings/ar";

const shared = vi.hoisted(() => ({
  configuredMode: "live" as "live" | "sanitized_fixture",
}));

vi.mock("../data", () => ({
  get configuredMode() {
    return shared.configuredMode;
  },
}));

vi.mock("../planUsage", () => ({ usePlanUsage: vi.fn() }));

const openPortal = vi.fn();
const openCheckout = vi.fn();
vi.mock("../paddle", () => ({
  openPortal: (...args: unknown[]) => openPortal(...args),
  openCheckout: (...args: unknown[]) => openCheckout(...args),
}));

import { usePlanUsage } from "../planUsage";
import {
  PlanPanel,
  PlanPanelView,
  DemoPlanPanel,
  type PlanPanelViewProps,
} from "./PlanPanel";

const W = "00000000-0000-4000-8000-000000000a1";
const readyPlace: WorkspaceState = {
  kind: "ready",
  id: W,
  name: "قناة سالم للتقنية",
  options: [{ id: W, name: "قناة سالم للتقنية" }],
};

const summary = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  plan_key: "creator_plus",
  status: "active",
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  cancel_at_period_end: false,
  billing_interval: "month",
  provider: "paddle",
  plan: {
    key: "creator_plus",
    segment: "individual",
    title_ar: "منشئ بلس",
    title_en: "Creator Plus",
    price_monthly_cents: 4900,
    price_yearly_cents: 49000,
    self_serve: true,
    provider_prices: {},
    allow_public_channels: false,
    limits: {
      analysis_units: 10000,
      topic_units: 4000,
      insight_reports: 10,
      channels: 1,
      members: 1,
      workspaces: 1,
      live_interval_minutes: 1440,
    },
  },
  budgets: [
    {
      event_type: "comment_analysis",
      used: 2500,
      allowance: 10000,
      granted: 0,
      remaining: 7500,
    },
    {
      event_type: "topic_classification",
      used: 400,
      allowance: 4000,
      granted: 0,
      remaining: 3600,
    },
  ],
  ...over,
});

function mountView(props: Partial<PlanPanelViewProps> = {}) {
  const defaults: PlanPanelViewProps = {
    place: readyPlace,
    usage: summary(),
    loading: false,
    failed: false,
    onPress: vi.fn(),
    pressNote: null,
  };
  return render(
    <MemoryRouter>
      <PlanPanelView {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe("PlanPanelView", () => {
  it("carries the workspace name under the heading, and one meter plus one door row", () => {
    mountView();
    const panel = screen.getByTestId("account-plan-panel");
    expect(panel).toHaveAttribute("aria-labelledby", "plan-panel-heading");
    expect(
      within(panel).getByRole("heading", { name: ar.planPanelTitle, level: 2 }),
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent("قناة سالم للتقنية");
    expect(within(panel).getAllByRole("progressbar")).toHaveLength(2);
    expect(
      within(panel).getByTestId(`plan-comment_analysis`),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId(`plan-topic_classification`),
    ).toBeInTheDocument();
    // paddle + self-serve business=false → manage, topup (no upgrade/contact)
    expect(
      within(panel).getByRole("button", { name: ar.planManage }),
    ).toHaveAttribute("data-action", "manage");
    expect(
      within(panel).getByRole("button", { name: ar.planTopup }),
    ).toHaveAttribute("data-action", "topup");
  });

  it("names each meter for its own budget, in the same words the row prints", () => {
    mountView();
    const analysis = screen.getByTestId("plan-comment_analysis");
    expect(
      within(analysis).getByRole("progressbar", { name: ar.budgetAnalysis }),
    ).toBeInTheDocument();
    expect(analysis).toHaveTextContent(ar.budgetAnalysis);
    expect(analysis).toHaveTextContent(ar.planUsedOf("2,500", "10,000"));
  });

  it("draws no meter for an unlimited budget — just the name and the line", () => {
    mountView({
      usage: summary({
        budgets: [
          {
            event_type: "comment_analysis",
            used: 500,
            allowance: -1,
            granted: 0,
            remaining: -1,
          },
        ],
      }),
    });
    const row = screen.getByTestId("plan-comment_analysis");
    expect(within(row).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(row).toHaveTextContent(ar.budgetAnalysis);
  });

  it("shows the plan's own notice as a status line", () => {
    mountView({
      usage: summary({
        status: "past_due",
        cancel_at_period_end: false,
      }),
    });
    expect(screen.getByTestId("plan-notice")).toHaveAttribute("role", "status");
  });

  it("renders the pricing and mailto doors as real links, not buttons", () => {
    mountView({
      usage: summary({
        provider: null,
        plan: {
          ...summary().plan!,
          segment: "business",
          self_serve: true,
          provider_prices: {},
        },
      }),
    });
    const upgrade = screen.getByRole("link", { name: ar.planUpgrade });
    expect(upgrade).toHaveAttribute("href", "/pricing");
    expect(upgrade).toHaveAttribute("data-action", "upgrade");
    const contact = screen.getByRole("link", { name: ar.planContact });
    expect(contact.getAttribute("href")).toMatch(/^mailto:/);
    expect(contact).toHaveAttribute("data-action", "contact");
  });

  it("a manage press calls back with the action", async () => {
    const onPress = vi.fn();
    mountView({ onPress });
    await userEvent.click(screen.getByRole("button", { name: ar.planManage }));
    expect(onPress).toHaveBeenCalledWith("manage");
  });

  it("the doors are disabled while a press is in flight", () => {
    mountView({ busy: true });
    expect(screen.getByRole("button", { name: ar.planManage })).toBeDisabled();
    expect(screen.getByRole("button", { name: ar.planTopup })).toBeDisabled();
  });

  it("says the plan is loading, as a status line, before anything else", () => {
    mountView({ loading: true });
    expect(screen.getByRole("status")).toHaveTextContent(ar.planLoading);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says no workspace is chosen yet, and offers no doors", () => {
    mountView({
      place: { kind: "choose", options: [] },
      usage: null,
    });
    expect(screen.getByText(ar.planNoneChosenNote)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says the plan could not be read, as an alert", () => {
    mountView({ failed: true });
    const alert = screen.getByTestId("plan-failed");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(ar.planFailedTitle);
    expect(alert).toHaveTextContent(ar.planFailedNote);
  });

  it("renders nothing at all when there is no workspace — the page beneath already says so", () => {
    const { container } = mountView({
      place: { kind: "no_workspaces" },
      usage: null,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("prints the press-feedback line as a status message", () => {
    mountView({ pressNote: "تعذّر إتمام العملية" });
    expect(screen.getByText("تعذّر إتمام العملية")).toHaveAttribute(
      "role",
      "status",
    );
  });
});

describe("DemoPlanPanel", () => {
  function mountDemo(usage: UsageSummary | null = summary()) {
    return render(
      <MemoryRouter>
        <DemoPlanPanel demo={{ usage, place: readyPlace }} />
      </MemoryRouter>,
    );
  }

  it("manage opens no external service — it says so instead", async () => {
    mountDemo();
    await userEvent.click(screen.getByRole("button", { name: ar.planManage }));
    expect(screen.getByText(ar.demoExternalNote)).toHaveAttribute(
      "role",
      "status",
    );
    expect(openPortal).not.toHaveBeenCalled();
  });

  it("topup says the same thing", async () => {
    mountDemo();
    await userEvent.click(screen.getByRole("button", { name: ar.planTopup }));
    expect(screen.getByText(ar.demoExternalNote)).toBeInTheDocument();
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("upgrade stays a real link in demo — pressing it never sets the note", () => {
    mountDemo(
      summary({
        provider: null,
        plan: { ...summary().plan!, self_serve: true },
      }),
    );
    const upgrade = screen.getByRole("link", { name: ar.planUpgrade });
    expect(upgrade).toHaveAttribute("href", "/pricing");
    expect(screen.queryByText(ar.demoExternalNote)).not.toBeInTheDocument();
  });
});

describe("PlanPanel (live)", () => {
  const session = { user: { id: "u1" } } as unknown as Session;

  beforeEach(() => {
    shared.configuredMode = "live";
    openPortal.mockReset();
    openCheckout.mockReset();
    vi.mocked(usePlanUsage).mockReturnValue({
      place: readyPlace,
      workspaceId: W,
      plan: { data: summary(), isPending: false, isError: false },
    } as unknown as ReturnType<typeof usePlanUsage>);
  });

  it("renders nothing when the build is not live", () => {
    shared.configuredMode = "sanitized_fixture";
    const { container } = render(
      <MemoryRouter>
        <PlanPanel session={session} workspaces={[]} loading={false} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("otherwise renders from usePlanUsage's own data", () => {
    render(
      <MemoryRouter>
        <PlanPanel session={session} workspaces={[]} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("account-plan-panel")).toHaveTextContent(
      "قناة سالم للتقنية",
    );
  });

  it("a manage press that fails with no_paddle_customer says so under the doors", async () => {
    openPortal.mockRejectedValueOnce(new Error("no_paddle_customer"));
    render(
      <MemoryRouter>
        <PlanPanel session={session} workspaces={[]} loading={false} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: ar.planManage }));
    expect(openPortal).toHaveBeenCalledWith(session, W);
    await waitFor(() =>
      expect(screen.getByText(ar.portalNoCustomer)).toBeInTheDocument(),
    );
  });

  it("a topup press that fails any other way says checkout is not available", async () => {
    openCheckout.mockRejectedValueOnce(new Error("boom"));
    render(
      <MemoryRouter>
        <PlanPanel session={session} workspaces={[]} loading={false} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: ar.planTopup }));
    expect(openCheckout).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(ar.checkoutUnavailable)).toBeInTheDocument(),
    );
  });

  it("the demo prop bypasses usePlanUsage entirely", () => {
    vi.mocked(usePlanUsage).mockClear();
    render(
      <MemoryRouter>
        <PlanPanel
          session={session}
          workspaces={[]}
          loading={false}
          demo={{ usage: summary(), place: readyPlace }}
        />
      </MemoryRouter>,
    );
    expect(usePlanUsage).not.toHaveBeenCalled();
    expect(screen.getByTestId("account-plan-panel")).toBeInTheDocument();
  });
});
