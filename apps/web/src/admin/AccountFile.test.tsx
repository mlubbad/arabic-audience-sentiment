// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AdminUser,
  AdminUserDetail,
  AdminWorkspace,
} from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { AccountFile } from "./AccountFile";
import * as adminRead from "./adminRead";
import * as adminPage from "./AdminPage";

vi.mock("./adminRead");
vi.mock("./AdminPage", () => ({
  readWorkspaces: vi.fn(),
  LiveWorkspaces: ({ rows }: { rows: AdminWorkspace[] }) => (
    <div data-testid="plans">{rows.map((r) => r.name).join(",")}</div>
  ),
}));
vi.mock("../planCatalogue", () => ({
  useAdminPlanCatalogue: () => ({ data: [] }),
}));

const USER: AdminUser = {
  id: "10000000-0000-4000-8000-000000000002",
  email: "customer@example.com",
  created_at: "2026-08-14T10:00:00+00:00",
  last_sign_in_at: "2026-10-09T09:12:00+00:00",
  workspace_count: 2,
  owner_count: 1,
};
const SHOP = "00000000-0000-4000-8000-000000000002";
const HOME = "00000000-0000-4000-8000-000000000001";

const DETAIL: AdminUserDetail = {
  id: USER.id,
  email: USER.email,
  created_at: USER.created_at,
  last_sign_in_at: USER.last_sign_in_at,
  email_confirmed_at: null,
  banned_until: null,
  profile: {
    display_name: "سارة أحمد",
    organization: null,
    phone: null,
    admin_note: null,
    updated_at: null,
  },
  memberships: [
    {
      workspace_id: SHOP,
      workspace_name: "Shop",
      role: "workspace_owner",
      created_by_user: true,
    },
    {
      workspace_id: HOME,
      workspace_name: "Home",
      role: "analyst",
      created_by_user: false,
    },
  ],
  history: [
    {
      at: "2026-10-08T18:40:00+00:00",
      action: "password_reset_sent",
      actor_email: "owner@example.com",
      by_self: false,
      workspace_name: null,
    },
  ],
};

const workspace = (id: string, name: string, created_by: string) =>
  ({
    id,
    name,
    created_by,
    plan_key: "free",
    status: "active",
    period_end: null,
    provider: null,
  }) satisfies AdminWorkspace;

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountFile user={USER} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("AccountFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminUserDetail).mockResolvedValue(DETAIL);
    vi.mocked(adminPage.readWorkspaces).mockResolvedValue([
      workspace(SHOP, "Shop", USER.id),
      workspace(HOME, "Home", "10000000-0000-4000-8000-000000000001"),
    ]);
  });

  it("shows the person, their sign-in facts, seats, plans and history", async () => {
    mount();
    expect(await screen.findByText("سارة أحمد")).toBeInTheDocument();
    expect(screen.getByText(USER.email!)).toBeInTheDocument();
    expect(screen.getByText(ar.adminAccountEmailUnconfirmed)).toBeVisible();
    expect(screen.getByText("2026-08-14")).toBeInTheDocument();

    const seats = screen.getByTestId("admin-account-seats");
    // The owner's seat is a label; another seat is a role picker.
    expect(within(seats).getByText(ar.shareWorkspaceRoleOwner)).toBeVisible();
    expect(
      within(seats).getByRole("combobox", { name: /Home/ }),
    ).toBeInTheDocument();

    // Plans: only the workspaces this person created.
    expect(await screen.findByTestId("plans")).toHaveTextContent(/^Shop$/);

    expect(screen.getByTestId("admin-account-history")).toHaveTextContent(
      ar.adminAccountActions.password_reset_sent!,
    );
    expect(screen.getByTestId("admin-account-history")).toHaveTextContent(
      ar.adminAccountHistoryBy("owner@example.com"),
    );
  });

  it("saves the details as typed and says so", async () => {
    vi.mocked(adminRead.saveAdminUserProfile).mockResolvedValue();
    mount();
    const org = await screen.findByLabelText(ar.adminAccountOrg);
    await userEvent.type(org, "متجر الأزياء");
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminAccountSave }),
    );
    expect(adminRead.saveAdminUserProfile).toHaveBeenCalledWith(USER.id, {
      display_name: "سارة أحمد",
      organization: "متجر الأزياء",
      phone: "",
      admin_note: "",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      ar.adminAccountSaved,
    );
  });

  it("names the database's refusal of a field too long", async () => {
    vi.mocked(adminRead.saveAdminUserProfile).mockRejectedValue({
      message: "profile_too_long",
      code: "22023",
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: ar.adminAccountSave }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      ar.adminAccountTooLong,
    );
  });

  it("sends a reset link to the person's own email, and says where", async () => {
    vi.mocked(adminRead.sendPasswordReset).mockResolvedValue();
    mount();
    await userEvent.click(
      await screen.findByTestId("admin-account-send-reset"),
    );
    expect(adminRead.sendPasswordReset).toHaveBeenCalledWith(
      USER.id,
      USER.email,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      ar.adminAccountResetSent(USER.email!),
    );
  });

  it("says plainly when the link could not be sent", async () => {
    vi.mocked(adminRead.sendPasswordReset).mockRejectedValue(
      new Error("rate limited"),
    );
    mount();
    await userEvent.click(
      await screen.findByTestId("admin-account-send-reset"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      ar.adminAccountResetFailed,
    );
  });

  it("cannot send a link to a person with no email", async () => {
    vi.mocked(adminRead.readAdminUserDetail).mockResolvedValue({
      ...DETAIL,
      email: null,
    });
    mount();
    expect(
      await screen.findByTestId("admin-account-send-reset"),
    ).toBeDisabled();
  });
});
