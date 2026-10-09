// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { ar } from "../strings/ar";
import { AdminUsersPage } from "./AdminUsersPage";
import * as adminReadModule from "./adminRead";
import * as sessionModule from "../session";
import * as impersonationModule from "../impersonation";
import * as adminShellModule from "./AdminShell";
import type { AdminAccount } from "@sentiment/contracts";

vi.mock("./adminRead");
vi.mock("./AccountFile", () => ({
  AccountFile: ({ user }: { user: { email: string } | null }) =>
    user ? <div data-testid="account-file">{user.email}</div> : null,
}));
vi.mock("../session");
vi.mock("../impersonation");
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

const account = (
  over: Partial<AdminAccount> & Pick<AdminAccount, "id" | "email">,
): AdminAccount => ({
  display_name: null,
  organization: null,
  created_at: "2026-02-15T12:00:00Z",
  last_sign_in_at: "2026-09-21T15:30:00Z",
  suspended: false,
  is_admin: false,
  is_test: false,
  workspaces: 1,
  owned: 1,
  channels: 1,
  plan_key: "creator",
  plan_status: "active",
  period_end: "2026-11-02T00:00:00Z",
  provider: "paddle",
  ...over,
});

const mockUsers: AdminAccount[] = [
  account({
    id: "admin-id",
    email: "admin@example.com",
    is_admin: true,
    workspaces: 102,
    owned: 102,
    channels: 101,
    plan_key: "owner",
  }),
  account({
    id: "user-client-1",
    email: "client1@example.com",
    display_name: "سارة أحمد",
    organization: "متجر الأزياء",
  }),
  account({
    id: "probe-1",
    email: "probe-1@example.com",
    is_test: true,
    suspended: true,
    plan_key: null,
    period_end: null,
  }),
];

describe("AdminUsersPage", () => {
  const startImpersonationMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(adminReadModule, "readAdminAccounts").mockResolvedValue(mockUsers);
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: {
        user: { id: "admin-id", email: "admin@example.com" },
      } as unknown as ReturnType<typeof sessionModule.useSession>["session"],
      loading: false,
    });
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: startImpersonationMock,
      stopImpersonation: vi.fn(),
    });
  });

  function mount() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminUsersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("renders the users list with actions column and correct impersonation buttons", async () => {
    mount();

    // Table header actions
    expect(await screen.findByText(ar.adminUsersActions)).toBeInTheDocument();

    // Admin user row shows "حسابك الحالي"
    expect(screen.getByTestId("admin-user-current")).toHaveTextContent(
      ar.adminUserCurrent,
    );

    // Other user row shows "الدخول كـ" button
    const impersonateBtn = screen.getByTestId(
      "admin-impersonate-user-client-1",
    );
    expect(impersonateBtn).toBeInTheDocument();
    expect(impersonateBtn).toHaveTextContent(ar.adminUserImpersonate);

    // Clicking impersonate invokes startImpersonation
    await userEvent.click(impersonateBtn);
    expect(startImpersonationMock).toHaveBeenCalledWith({
      id: "user-client-1",
      email: "client1@example.com",
    });
  });

  it("opens the account file of the person whose Manage was pressed", async () => {
    mount();
    expect(screen.queryByTestId("account-file")).toBeNull();
    await userEvent.click(
      await screen.findByTestId("admin-manage-user-client-1"),
    );
    expect(screen.getByTestId("account-file")).toHaveTextContent(
      "client1@example.com",
    );
  });

  it("opens the file the search box asked for with ?u=", async () => {
    window.history.replaceState({}, "", "/admin/users?u=user-client-1");
    mount();
    expect(await screen.findByTestId("account-file")).toHaveTextContent(
      "client1@example.com",
    );
    window.history.replaceState({}, "", "/");
  });

  it("keeps customers, test accounts and admins in their own sections, and searches by name", async () => {
    mount();
    await screen.findByTestId("admin-users");
    expect(screen.getByTestId("admin-accounts-customers")).toHaveTextContent(
      "1",
    );
    await userEvent.click(screen.getByTestId("admin-accounts-customers"));
    expect(
      screen.getAllByTestId("admin-user-email").map((e) => e.textContent),
    ).toEqual(["client1@example.com"]);
    await userEvent.click(screen.getByTestId("admin-accounts-test"));
    const probe = screen.getByTestId("admin-account-row-probe-1");
    expect(probe).toHaveTextContent(ar.adminAccountsTagTest);
    expect(probe).toHaveTextContent(ar.adminAccountSuspended);
    expect(probe).toHaveTextContent(ar.adminAccountsNoPlan);
    await userEvent.click(screen.getByTestId("admin-accounts-all"));
    await userEvent.type(
      screen.getByRole("searchbox", { name: ar.adminAccountsSearch }),
      "ساره",
    );
    expect(
      screen.getAllByTestId("admin-user-email").map((e) => e.textContent),
    ).toEqual(["client1@example.com"]);
    expect(
      screen.getByTestId("admin-account-row-user-client-1"),
    ).toHaveTextContent("سارة أحمد");
  });
});
