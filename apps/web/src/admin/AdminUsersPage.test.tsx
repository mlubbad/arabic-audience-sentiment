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
import type { AdminUser } from "@sentiment/contracts";

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

const mockUsers: AdminUser[] = [
  {
    id: "admin-id",
    email: "admin@example.com",
    created_at: "2026-01-01T10:00:00Z",
    last_sign_in_at: "2026-09-22T10:00:00Z",
    workspace_count: 2,
    owner_count: 2,
  },
  {
    id: "user-client-1",
    email: "client1@example.com",
    created_at: "2026-02-15T12:00:00Z",
    last_sign_in_at: "2026-09-21T15:30:00Z",
    workspace_count: 1,
    owner_count: 1,
  },
];

describe("AdminUsersPage", () => {
  const startImpersonationMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(adminReadModule, "readAdminUsers").mockResolvedValue(mockUsers);
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
    expect(startImpersonationMock).toHaveBeenCalledWith(mockUsers[1]);
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
});
