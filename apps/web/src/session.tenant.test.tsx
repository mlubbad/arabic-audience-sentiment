// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createElement, type ReactNode } from "react";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { useWorkspaces } from "./session";

describe("Tenant isolation in useWorkspaces", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  it("does not send target_user_id when not impersonating", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ id: "ws-1", name: "Workspace 1", created_by: "user-regular" }],
      error: null,
    });

    const session = { user: { id: "user-regular" } } as Session;
    const { result } = renderHook(() => useWorkspaces(session), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(rpcMock).toHaveBeenCalledWith("my_workspaces", {});
    expect(rpcMock).not.toHaveBeenCalledWith(
      "my_workspaces",
      expect.objectContaining({
        target_user_id: expect.anything(),
      }),
    );
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.workspaces).toEqual([
      { id: "ws-1", name: "Workspace 1", created_by: "user-regular" },
    ]);
  });

  it("sends target_user_id when impersonating via overrideUserId", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ id: "ws-target", name: "Target WS", created_by: "target-user" }],
      error: null,
    });

    const session = { user: { id: "admin-user" } } as Session;
    const { result } = renderHook(() => useWorkspaces(session, "target-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(rpcMock).toHaveBeenCalledWith("my_workspaces", {
      target_user_id: "target-user",
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.workspaces).toEqual([
      { id: "ws-target", name: "Target WS", created_by: "target-user" },
    ]);
  });

  it("fails closed without querying workspaces table when my_workspaces fails", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "tenant permission denied", code: "42501" },
    });
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: "leaked-ws", name: "Leaked WS", created_by: "other" }],
        error: null,
      }),
    });

    const session = { user: { id: "user-regular" } } as Session;
    const { result } = renderHook(() => useWorkspaces(session), { wrapper });

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });

    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.isError).toBe(true);
  });
});
