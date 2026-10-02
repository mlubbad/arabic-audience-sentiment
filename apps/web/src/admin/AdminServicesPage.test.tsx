// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { ar } from "../strings/ar";
import { AdminServicesPage } from "./AdminServicesPage";
import { getDemoServicesHealth } from "./adminServicesDemo";
import * as adminReadModule from "./adminRead";
import * as adminShellModule from "./AdminShell";

vi.mock("./adminRead");
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof adminShellModule>();
  return {
    ...actual,
    useAdminShell: () => ({
      admin: true,
      role: "owner",
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
  };
});

describe("AdminServicesPage", () => {
  const baseDemo = getDemoServicesHealth();
  const mockHealthReport = {
    ...baseDemo,
    services: baseDemo.services.map((s) =>
      s.id === "x_twitter_api"
        ? {
            ...s,
            status: "degraded" as const,
            quota_used: 88,
            quota_total: 100,
            quota_unit: "طلب / 15 دقيقة",
            details: "اقتراب من حد الطلبات (HTTP 429 Rate Warning)",
            endpoint: "https://api.twitter.com/2/tweets",
            error_code: "RATE_LIMIT_WARNING",
            remediation:
              "ينصح بتقليل وتيرة المزامنة اللحظية لحسابات X أو ترقية باقة الـ Bearer Token.",
          }
        : s,
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(adminReadModule, "readAdminServicesHealth").mockResolvedValue(
      mockHealthReport,
    );
  });

  const renderComponent = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdminServicesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("renders page title, KPI cards, and all categories", async () => {
    renderComponent();

    // Wait for services data to load
    expect(
      await screen.findByRole("heading", {
        name: ar.adminServicesCatInfrastructure,
      }),
    ).toBeInTheDocument();

    // Verify Title & Lead
    expect(
      screen.getByRole("heading", { name: ar.adminServicesTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.adminServicesLead)).toBeInTheDocument();

    // Verify KPIs
    expect(
      screen.getAllByText(ar.adminServicesKpiOverall)[0],
    ).toBeInTheDocument();
    expect(
      screen.getByText(ar.adminServicesKpiServicesCount),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.adminServicesKpiAvgLatency)).toBeInTheDocument();

    // Verify Categories
    expect(
      screen.getByRole("heading", {
        name: ar.adminServicesCatInfrastructure,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: ar.adminServicesCatAi }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: ar.adminServicesCatIngestion,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: ar.adminServicesCatBilling }),
    ).toBeInTheDocument();

    // Verify Key Services are rendered
    expect(
      screen.getByText("قاعدة بيانات Supabase Postgres"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("عامل المعالجة الخلفي (Python Worker Daemon)"),
    ).toBeInTheDocument();
    expect(screen.getByText("YouTube Data API v3")).toBeInTheDocument();
  });

  it("defaults to 30s auto-refresh and persists changes in localStorage", async () => {
    const user = userEvent.setup();
    renderComponent();

    const select = (await screen.findByTestId(
      "admin-refresh-select",
    )) as HTMLSelectElement;
    expect(select.value).toBe("30000");

    // Check countdown display
    expect(screen.getByTestId("admin-services-countdown")).toHaveTextContent(
      "30",
    );

    // Switch to 10s
    await user.selectOptions(select, "10000");
    expect(select.value).toBe("10000");
    expect(
      localStorage.getItem("sentiment_admin_health_refresh_interval"),
    ).toBe("10000");
    expect(screen.getByTestId("admin-services-countdown")).toHaveTextContent(
      "10",
    );
  });

  it("filters services by status pills", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("YouTube Data API v3");

    // Click 'تحذير' (Degraded)
    const degradedPill = screen.getByRole("button", {
      name: new RegExp(ar.adminServicesFilterDegraded),
    });
    await user.click(degradedPill);

    // X/Twitter is degraded
    expect(
      screen.getByText("منصة X (Twitter Data Ingestion)"),
    ).toBeInTheDocument();
    // Supabase Postgres is healthy, should not be visible
    expect(
      screen.queryByText("قاعدة بيانات Supabase Postgres"),
    ).not.toBeInTheDocument();

    // Switch back to All
    const allPill = screen.getByRole("button", {
      name: new RegExp(ar.adminServicesFilterAll),
    });
    await user.click(allPill);
    expect(
      screen.getByText("قاعدة بيانات Supabase Postgres"),
    ).toBeInTheDocument();
  });

  it("filters services dynamically by search input", async () => {
    const user = userEvent.setup();
    renderComponent();

    const searchInput = await screen.findByPlaceholderText(
      ar.adminServicesSearchPlaceholder,
    );

    // Search for Telegram
    await user.type(searchInput, "telegram");

    expect(screen.getByText("Telegram Bot API")).toBeInTheDocument();
    expect(
      screen.queryByText("قاعدة بيانات Supabase Postgres"),
    ).not.toBeInTheDocument();
  });

  it("opens technical diagnostics modal with latency, endpoints, and remediation", async () => {
    const user = userEvent.setup();
    renderComponent();

    // Find the technical diagnostics button for X/Twitter (which has remediation)
    const xCard = (
      await screen.findByText("منصة X (Twitter Data Ingestion)")
    ).closest(".admin-service-card")!;
    const detailsBtn = xCard.querySelector("button")!;
    await user.click(detailsBtn);

    // Dialog title & description
    expect(
      await screen.findByRole("heading", {
        name: ar.adminServicesDialogTitle,
      }),
    ).toBeInTheDocument();

    // Endpoint & Error Code
    expect(
      screen.getByText("https://api.twitter.com/2/tweets"),
    ).toBeInTheDocument();
    expect(screen.getByText("RATE_LIMIT_WARNING")).toBeInTheDocument();
    expect(
      screen.getByText(
        "ينصح بتقليل وتيرة المزامنة اللحظية لحسابات X أو ترقية باقة الـ Bearer Token.",
      ),
    ).toBeInTheDocument();

    // Close Dialog
    const closeBtn = screen.getByRole("button", {
      name: ar.adminServicesDialogClose,
    });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {
          name: ar.adminServicesDialogTitle,
        }),
      ).not.toBeInTheDocument();
    });
  });
});
