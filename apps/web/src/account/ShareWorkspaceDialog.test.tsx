// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "../strings/ar";
import { ShareWorkspaceDialog } from "./ShareWorkspaceDialog";
import { supabase } from "../supabase";

vi.mock("../supabase", () => {
  return {
    supabase: {
      rpc: vi.fn(),
    },
  };
});

const W = "00000000-0000-4000-8000-0000000000a2";

type RpcReturn = ReturnType<NonNullable<typeof supabase>["rpc"]>;

function mockRpcData(data: unknown): RpcReturn {
  return Promise.resolve({ data, error: null }) as unknown as RpcReturn;
}

function mockRpcError(message: string): RpcReturn {
  return Promise.resolve({
    data: null,
    error: { message, code: "P0001", details: "", hint: "" },
  }) as unknown as RpcReturn;
}

describe("ShareWorkspaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads accounts and displays owner and limit", async () => {
    vi.mocked(supabase!.rpc).mockReturnValueOnce(
      mockRpcData({
        accounts: [
          {
            user_id: "user-owner",
            email: "owner@example.com",
            role: "workspace_owner",
            is_owner: true,
            joined_at: new Date().toISOString(),
          },
          {
            user_id: "user-analyst",
            email: "analyst@example.com",
            role: "analyst",
            is_owner: false,
            joined_at: new Date().toISOString(),
          },
        ],
        members_count: 2,
        members_limit: 5,
        can_manage: true,
      }),
    );

    render(
      <ShareWorkspaceDialog
        open={true}
        workspaceId={W}
        workspaceName="مطبخ ريم"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId(`share-dialog-${W}`)).toBeInTheDocument();
    expect(
      screen.getByText(ar.shareWorkspaceTitle("مطبخ ريم")),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(ar.shareWorkspaceAccountsCount(2, 5)),
      ).toBeInTheDocument();
      expect(screen.getByText("owner@example.com")).toBeInTheDocument();
      expect(screen.getByText("analyst@example.com")).toBeInTheDocument();
    });

    expect(supabase!.rpc).toHaveBeenCalledWith("list_workspace_accounts", {
      w: W,
    });
  });

  it("submits email to share_workspace and refreshes list", async () => {
    vi.mocked(supabase!.rpc)
      // Initial load
      .mockReturnValueOnce(
        mockRpcData({
          accounts: [
            {
              user_id: "user-owner",
              email: "owner@example.com",
              role: "workspace_owner",
              is_owner: true,
              joined_at: new Date().toISOString(),
            },
          ],
          members_count: 1,
          members_limit: 5,
          can_manage: true,
        }),
      )
      // Share RPC call
      .mockReturnValueOnce(
        mockRpcData({
          success: true,
        }),
      )
      // Reload accounts
      .mockReturnValueOnce(
        mockRpcData({
          accounts: [
            {
              user_id: "user-owner",
              email: "owner@example.com",
              role: "workspace_owner",
              is_owner: true,
              joined_at: new Date().toISOString(),
            },
            {
              user_id: "user-new",
              email: "colleague@example.com",
              role: "analyst",
              is_owner: false,
              joined_at: new Date().toISOString(),
            },
          ],
          members_count: 2,
          members_limit: 5,
          can_manage: true,
        }),
      );

    render(
      <ShareWorkspaceDialog
        open={true}
        workspaceId={W}
        workspaceName="مطبخ ريم"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("share-email-input")).toBeInTheDocument();
    });

    const emailInput = screen.getByTestId("share-email-input");
    await userEvent.type(emailInput, "colleague@example.com");

    const submitBtn = screen.getByTestId("share-submit-btn");
    await userEvent.click(submitBtn);

    expect(supabase!.rpc).toHaveBeenCalledWith("share_workspace", {
      w: W,
      target_email: "colleague@example.com",
      role_to_assign: "analyst",
    });

    await waitFor(() => {
      expect(screen.getByTestId("share-success")).toHaveTextContent(
        ar.shareWorkspaceDone,
      );
      expect(screen.getByText("colleague@example.com")).toBeInTheDocument();
    });
  });

  it("displays user not found error when target email is not registered", async () => {
    vi.mocked(supabase!.rpc)
      .mockReturnValueOnce(
        mockRpcData({
          accounts: [
            {
              user_id: "user-owner",
              email: "owner@example.com",
              role: "workspace_owner",
              is_owner: true,
              joined_at: new Date().toISOString(),
            },
          ],
          members_count: 1,
          members_limit: 5,
          can_manage: true,
        }),
      )
      .mockReturnValueOnce(mockRpcError("user_not_found"));

    render(
      <ShareWorkspaceDialog
        open={true}
        workspaceId={W}
        workspaceName="مطبخ ريم"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("share-email-input")).toBeInTheDocument();
    });

    const emailInput = screen.getByTestId("share-email-input");
    await userEvent.type(emailInput, "notfound@example.com");

    const submitBtn = screen.getByTestId("share-submit-btn");
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("share-error")).toHaveTextContent(
        ar.shareWorkspaceUserNotFound,
      );
    });
  });

  it("displays limit reached warning when members_count >= members_limit", async () => {
    vi.mocked(supabase!.rpc).mockReturnValueOnce(
      mockRpcData({
        accounts: [
          {
            user_id: "user-owner",
            email: "owner@example.com",
            role: "workspace_owner",
            is_owner: true,
            joined_at: new Date().toISOString(),
          },
        ],
        members_count: 1,
        members_limit: 1,
        can_manage: true,
      }),
    );

    render(
      <ShareWorkspaceDialog
        open={true}
        workspaceId={W}
        workspaceName="مطبخ ريم"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(ar.shareWorkspaceLimitReached),
      ).toBeInTheDocument();
      expect(screen.getByTestId("share-email-input")).toBeDisabled();
      expect(screen.getByTestId("share-submit-btn")).toBeDisabled();
    });
  });

  it("handles unsharing a member", async () => {
    vi.mocked(supabase!.rpc)
      .mockReturnValueOnce(
        mockRpcData({
          accounts: [
            {
              user_id: "user-owner",
              email: "owner@example.com",
              role: "workspace_owner",
              is_owner: true,
              joined_at: new Date().toISOString(),
            },
            {
              user_id: "user-member",
              email: "member@example.com",
              role: "viewer",
              is_owner: false,
              joined_at: new Date().toISOString(),
            },
          ],
          members_count: 2,
          members_limit: 5,
          can_manage: true,
        }),
      )
      .mockReturnValueOnce(
        mockRpcData({
          success: true,
        }),
      )
      .mockReturnValueOnce(
        mockRpcData({
          accounts: [
            {
              user_id: "user-owner",
              email: "owner@example.com",
              role: "workspace_owner",
              is_owner: true,
              joined_at: new Date().toISOString(),
            },
          ],
          members_count: 1,
          members_limit: 5,
          can_manage: true,
        }),
      );

    render(
      <ShareWorkspaceDialog
        open={true}
        workspaceId={W}
        workspaceName="مطبخ ريم"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("share-remove-user-member"),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("share-remove-user-member"));

    expect(supabase!.rpc).toHaveBeenCalledWith("unshare_workspace", {
      w: W,
      target_user: "user-member",
    });

    await waitFor(() => {
      expect(screen.queryByText("member@example.com")).not.toBeInTheDocument();
    });
  });
});
