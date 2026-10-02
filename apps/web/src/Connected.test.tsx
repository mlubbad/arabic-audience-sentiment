// @vitest-environment jsdom

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Connected } from "./Connected";

const completePendingConnection = vi.hoisted(() => vi.fn());

vi.mock("./connectResult", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectResult")>()),
  completePendingConnection,
}));

describe("Connected", () => {
  beforeEach(() => {
    completePendingConnection.mockReset();
    completePendingConnection.mockResolvedValue({ kind: "success" });
  });

  function renderConnected() {
    const router = createMemoryRouter(
      [{ path: "/connected", element: <Connected /> }],
      { initialEntries: ["/connected?connect=pending&ticket=abc"] },
    );
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    return router;
  }

  it("completes once, renders success, and replaces the ticket URL", async () => {
    completePendingConnection.mockResolvedValueOnce({
      kind: "success",
      channelId: "channel-one",
    });
    const router = renderConnected();

    await waitFor(() =>
      expect(completePendingConnection).toHaveBeenCalledTimes(1),
    );
    expect(completePendingConnection).toHaveBeenCalledWith("abc");
    await waitFor(() =>
      expect(router.state.location.search).toBe("?connect=pending"),
    );
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.getByRole("heading").textContent).toBe("تم ربط القناة");
    expect(screen.getByTestId("connect-result").getAttribute("data-tone")).toBe(
      "success",
    );
  });

  it("keeps the binding-error result while replacing the ticket URL", async () => {
    completePendingConnection.mockResolvedValueOnce({
      kind: "error",
      code: "oauth_binding_mismatch",
    });
    const router = renderConnected();

    await waitFor(() =>
      expect(router.state.location.search).toBe("?connect=pending"),
    );
    expect(screen.getByRole("heading").textContent).toBe("تعذر إتمام الربط");
    expect(screen.getByTestId("connect-result").getAttribute("data-tone")).toBe(
      "error",
    );
  });
});
