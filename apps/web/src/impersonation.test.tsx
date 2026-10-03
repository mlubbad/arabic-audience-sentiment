// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ImpersonationProvider, useImpersonation } from "./impersonation";
import { ar } from "./strings/ar";

const mockNavigate = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
const mockRpc = vi.fn();
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

let mockSupabaseClient: { rpc: (...args: unknown[]) => unknown } | null = {
  rpc: (...args: unknown[]) => mockRpc(...args),
};

vi.mock("./supabase", () => ({
  get supabase() {
    return mockSupabaseClient;
  },
}));

vi.mock("./ui/Toast", () => ({
  toast: mockToast,
}));

describe("ImpersonationProvider and useImpersonation", () => {
  beforeEach(() => {
    mockSupabaseClient = {
      rpc: (...args: unknown[]) => mockRpc(...args),
    };
    sessionStorage.clear();
    mockNavigate.mockReset();
    mockInvalidateQueries.mockReset();
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockToast.mockReset();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ImpersonationProvider>{children}</ImpersonationProvider>
  );

  it("initializes with isImpersonating=false when sessionStorage is empty", () => {
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
  });

  it("initializes with stored impersonated target when sessionStorage has valid session", () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "user-123", email: "stored@example.com" }),
    );

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);
    expect(result.current.impersonatedUser).toEqual({
      id: "user-123",
      email: "stored@example.com",
    });
  });

  it("startImpersonation updates storage, state, calls RPC, invalidates queries and navigates", async () => {
    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.startImpersonation({
        id: "target-456",
        email: "target@example.com",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("admin_start_impersonation", {
      p_target_user_id: "target-456",
    });

    const stored = JSON.parse(
      sessionStorage.getItem("sentiment_impersonation_session") || "null",
    );
    expect(stored).toEqual({
      id: "target-456",
      email: "target@example.com",
    });

    expect(result.current.isImpersonating).toBe(true);
    expect(result.current.impersonatedUser).toEqual({
      id: "target-456",
      email: "target@example.com",
    });
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("stopImpersonation clears storage, calls RPC, invalidates queries and navigates to /admin/users", async () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "target-456", email: "target@example.com" }),
    );

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);

    await act(async () => {
      await result.current.stopImpersonation();
    });

    expect(mockRpc).toHaveBeenCalledWith("admin_stop_impersonation", {
      p_target_user_id: "target-456",
    });
    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
    expect(mockToast).toHaveBeenCalledWith({
      title: ar.adminImpersonateStopping,
    });
    expect(mockToast).not.toHaveBeenCalledWith({
      title: ar.adminImpersonateAuditWarning,
    });
  });

  it("fails closed on startImpersonation RPC error without updating session or navigating", async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: "P0001", message: "Audit log failed" },
    });

    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.startImpersonation({
        id: "target-456",
        email: "target@example.com",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("admin_start_impersonation", {
      p_target_user_id: "target-456",
    });
    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("exits impersonation and warns when the stop audit RPC returns an error", async () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "target-456", email: "target@example.com" }),
    );

    mockRpc.mockResolvedValueOnce({
      error: { code: "P0001", message: "Audit stop failed" },
    });

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);

    await act(async () => {
      await result.current.stopImpersonation();
    });

    expect(mockRpc).toHaveBeenCalledWith("admin_stop_impersonation", {
      p_target_user_id: "target-456",
    });
    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
    expect(mockToast).toHaveBeenCalledWith({
      title: ar.adminImpersonateAuditWarning,
    });
  });

  it("fails closed on startImpersonation when supabase client is null", async () => {
    mockSupabaseClient = null;

    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.startImpersonation({
        id: "target-456",
        email: "target@example.com",
      });
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("exits impersonation and warns when the Supabase client is unavailable", async () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "target-456", email: "target@example.com" }),
    );

    mockSupabaseClient = null;

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);

    await act(async () => {
      await result.current.stopImpersonation();
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
    expect(mockToast).toHaveBeenCalledWith({
      title: ar.adminImpersonateAuditWarning,
    });
  });

  it("fails closed on startImpersonation on HTTP 500", async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: "500", message: "Internal Server Error", status: 500 },
    });

    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.startImpersonation({
        id: "target-456",
        email: "target@example.com",
      });
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("exits impersonation and warns when the stop audit returns HTTP 500", async () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "target-456", email: "target@example.com" }),
    );

    mockRpc.mockResolvedValueOnce({
      error: { code: "500", message: "Internal Server Error", status: 500 },
    });

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);

    await act(async () => {
      await result.current.stopImpersonation();
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
    expect(mockToast).toHaveBeenCalledWith({
      title: ar.adminImpersonateAuditWarning,
    });
  });

  it("fails closed on startImpersonation on rejected fetch", async () => {
    mockRpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.startImpersonation({
        id: "target-456",
        email: "target@example.com",
      });
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("exits impersonation and warns when the stop audit RPC throws", async () => {
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "target-456", email: "target@example.com" }),
    );

    mockRpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);

    await act(async () => {
      await result.current.stopImpersonation();
    });

    expect(
      sessionStorage.getItem("sentiment_impersonation_session"),
    ).toBeNull();
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.impersonatedUser).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
    expect(mockToast).toHaveBeenCalledWith({
      title: ar.adminImpersonateAuditWarning,
    });
  });
});
