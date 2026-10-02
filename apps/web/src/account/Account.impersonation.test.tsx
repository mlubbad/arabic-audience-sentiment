// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as impersonationModule from "../impersonation";
import * as adminAccessModule from "../adminAccess";
import * as sessionModule from "../session";
import * as planCatalogueModule from "../planCatalogue";
import { supabase } from "../supabase";
import { Account } from "./Account";

vi.mock("../supabase", () => {
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "workspaces") {
      return {
        select: vi.fn().mockResolvedValue({
          data: [{ id: "ws-1", name: "مساحة العمل التجريبية" }],
          error: null,
        }),
      };
    }
    if (table === "clients") {
      return {
        select: vi.fn().mockResolvedValue({
          data: [{ id: "c-1", workspace_id: "ws-1" }],
          error: null,
        }),
      };
    }
    if (table === "connection_status") {
      return {
        select: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      };
    }
    if (table === "jobs") {
      return {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "subscriptions") {
      return {
        select: vi.fn().mockResolvedValue({
          data: [{ workspace_id: "ws-1", plan_key: "free" }],
          error: null,
        }),
      };
    }
    return {
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
  });

  const rpcMock = vi.fn().mockImplementation((fn: string) => {
    if (fn === "my_workspaces") {
      return Promise.resolve({
        data: [{ id: "ws-1", name: "مساحة العمل التجريبية" }],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return {
    supabase: {
      from: fromMock,
      rpc: rpcMock,
      auth: {
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              user: { id: "admin-id", email: "admin@example.com" },
            },
          },
          error: null,
        }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    },
  };
});

describe("Account impersonation boundary for experimental public channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sessionModule, "useSession").mockReturnValue({
      session: {
        user: { id: "admin-id", email: "admin@example.com" },
      } as unknown as ReturnType<typeof sessionModule.useSession>["session"],
      loading: false,
    });

    vi.spyOn(planCatalogueModule, "usePlanCatalogue").mockReturnValue({
      data: [
        {
          key: "free",
          name_ar: "مجاني",
          name_en: "Free",
          allow_public_channels: false,
          max_workspaces: 1,
          max_videos_per_run: 5,
          max_comments_per_video: 50,
          monthly_comment_limit: 500,
          max_analyses_per_month: 5,
          sync_interval_hours: 24,
          max_team_members: 1,
        },
        {
          key: "owner",
          name_ar: "مالك",
          name_en: "Owner",
          allow_public_channels: true,
          max_workspaces: 99,
          max_videos_per_run: 100,
          max_comments_per_video: 1000,
          monthly_comment_limit: 100000,
          max_analyses_per_month: 1000,
          sync_interval_hours: 1,
          max_team_members: 99,
        },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof planCatalogueModule.usePlanCatalogue>);
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/account"]}>
          <Account />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("strictly hides public channel experiment when admin is impersonating a normal user", async () => {
    // Admin is impersonating a standard user
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: true,
      impersonatedUser: {
        id: "user-target-id",
        email: "ytapitest2023@gmail.com",
      },
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    // The backend RPC still says the admin JWT is an admin
    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: true,
      isLoading: false,
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("مساحة العمل التجريبية")).toBeInTheDocument();
    });

    // Must NOT show the experimental "لا أملك القناة" choice card
    expect(screen.queryByTestId("channel-setup-ws-1")).toBeNull();
    expect(screen.queryByTestId("addchannel-ws-1")).toBeNull();
    expect(
      screen.queryByText(
        "حدد القناة إما بالربط كمالك أو بالاختيار كقناة عامة.",
      ),
    ).toBeNull();

    // Must show standard direct connect button and standard Step 02 text
    expect(screen.getByTestId("connect-ws-1")).toBeInTheDocument();
    expect(
      screen.getByText("اربط قناة يوتيوب بعد موافقتك على الإذن."),
    ).toBeInTheDocument();
  });

  it("displays public channel experiment when admin is viewing their own account without impersonation", async () => {
    // Admin viewing their own account
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    vi.spyOn(adminAccessModule, "useIsPlatformAdmin").mockReturnValue({
      data: true,
      isLoading: false,
    } as unknown as ReturnType<typeof adminAccessModule.useIsPlatformAdmin>);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("مساحة العمل التجريبية")).toBeInTheDocument();
    });

    // Owner sees both choices
    expect(screen.getByTestId("channel-setup-ws-1")).toBeInTheDocument();
    expect(screen.getByTestId("connect-ws-1")).toBeInTheDocument();
    expect(screen.getByTestId("addchannel-ws-1")).toBeInTheDocument();
    expect(
      screen.getByText("حدد القناة إما بالربط كمالك أو بالاختيار كقناة عامة."),
    ).toBeInTheDocument();
  });

  it("does not pass target_user_id to my_workspaces when not impersonating", async () => {
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    renderPage();

    await waitFor(() => {
      expect(supabase?.rpc).toHaveBeenCalledWith("my_workspaces", {});
    });
    expect(supabase?.rpc).not.toHaveBeenCalledWith(
      "my_workspaces",
      expect.objectContaining({
        target_user_id: expect.anything(),
      }),
    );
    expect(supabase?.from).not.toHaveBeenCalledWith("workspaces");
  });

  it("fails closed without querying from('workspaces') when my_workspaces fails", async () => {
    vi.spyOn(impersonationModule, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: "tenant isolation error", code: "42501" },
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذر تحميل مساحات العمل")).toBeInTheDocument();
    });

    expect(supabase?.from).not.toHaveBeenCalledWith("workspaces");
    expect(screen.queryByText("مساحة العمل التجريبية")).toBeNull();
  });
});
