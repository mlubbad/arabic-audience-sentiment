// @vitest-environment jsdom

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "./strings/ar";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Connected } from "./Connected";

const completePendingConnection = vi.hoisted(() => vi.fn());
const listPageChoices = vi.hoisted(() => vi.fn());

vi.mock("./connectResult", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectResult")>()),
  completePendingConnection,
  listPageChoices,
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

  it("asks which page when the account manages several, then connects the chosen one", async () => {
    completePendingConnection
      .mockResolvedValueOnce({ kind: "choose" })
      .mockResolvedValueOnce({ kind: "success", channelId: "channel-two" });
    listPageChoices.mockResolvedValue({
      kind: "choices",
      choices: [
        { id: "c-1", external_channel: "111", title: "صفحة أ", handle: "a" },
        { id: "c-2", external_channel: "222", title: "صفحة ب", handle: null },
      ],
    });
    renderConnected();

    expect(await screen.findByText(ar.crChoosePageHeading)).toBeTruthy();
    expect(listPageChoices).toHaveBeenCalledWith("abc");
    await userEvent.click(
      await screen.findByRole("button", { name: /صفحة ب/ }),
    );
    await waitFor(() =>
      expect(completePendingConnection).toHaveBeenLastCalledWith("abc", "c-2"),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading").textContent).toBe("تم ربط القناة"),
    );
  });

  it("names the result page for any platform, not YouTube only", async () => {
    renderConnected();
    expect(await screen.findByText(ar.connectedEyebrow)).toBeTruthy();
    expect(ar.connectedEyebrow).not.toMatch(/يوتيوب/);
  });
});
