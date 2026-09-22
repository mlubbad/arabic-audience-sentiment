// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as sessionModule from "../session";
import * as adminAccessModule from "../adminAccess";
import * as impersonationModule from "../impersonation";
import { useAdminShell } from "./AdminShell";
import { ar } from "../strings/ar";

vi.mock("../session");
vi.mock("../adminAccess");
vi.mock("../impersonation");

function TestAdminConsumer() {
  const { admin, shell } = useAdminShell();
  return (
    <div>
      <div data-testid="admin-flag">{String(admin)}</div>
      {shell(<div data-testid="admin-body">Admin Body Content</div>)}
    </div>
  );
}

describe("useAdminShell authorization and impersonation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants access to platform admin when not impersonating", () => {
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { user: { id: "admin-user-id" } } as unknown as ReturnType<
        typeof sessionModule.useSession
      >["session"],
      loading: false,
    });
    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: true,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    render(<TestAdminConsumer />);
    expect(screen.getByTestId("admin-flag")).toHaveTextContent("true");
    expect(screen.getByTestId("admin-body")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-forbidden")).toBeNull();
  });

  it("denies access to non-admin users", () => {
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { user: { id: "regular-user-id" } } as unknown as ReturnType<
        typeof sessionModule.useSession
      >["session"],
      loading: false,
    });
    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    render(<TestAdminConsumer />);
    expect(screen.getByTestId("admin-flag")).toHaveTextContent("false");
    expect(screen.queryByTestId("admin-body")).toBeNull();
    const forbidden = screen.getByTestId("admin-forbidden");
    expect(forbidden).toBeInTheDocument();
    expect(forbidden).toHaveTextContent(ar.adminForbidden);
  });

  it("denies access and renders forbidden when platform admin is in impersonation mode", () => {
    // Admin session + is_platform_admin returns true:
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { user: { id: "admin-user-id" } } as unknown as ReturnType<
        typeof sessionModule.useSession
      >["session"],
      loading: false,
    });
    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: true,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);
    // BUT impersonation mode is active:
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: true,
      impersonatedUser: { id: "client-id", email: "client@example.com" },
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    render(<TestAdminConsumer />);
    expect(screen.getByTestId("admin-flag")).toHaveTextContent("false");
    expect(screen.queryByTestId("admin-body")).toBeNull();
    const forbidden = screen.getByTestId("admin-forbidden");
    expect(forbidden).toBeInTheDocument();
    expect(forbidden).toHaveTextContent(ar.adminForbidden);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AdminPage } from "./AdminPage";

describe("AdminPage impersonation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/admin");
  });

  it("renders forbidden alert and hides admin tabs when platform admin is impersonating", () => {
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { user: { id: "admin-user-id" } } as unknown as ReturnType<
        typeof sessionModule.useSession
      >["session"],
      loading: false,
    });
    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: true,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: true,
      impersonatedUser: { id: "client-id", email: "client@example.com" },
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const forbidden = screen.getByTestId("admin-forbidden");
    expect(forbidden).toBeInTheDocument();
    expect(forbidden).toHaveTextContent(ar.adminForbidden);
    expect(
      screen.queryByRole("navigation", { name: ar.adminTabsLabel }),
    ).toBeNull();
  });
});
