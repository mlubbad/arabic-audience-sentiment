// @vitest-environment jsdom

import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

  it("completes a pending OAuth ticket once under React StrictMode", async () => {
    render(
      <StrictMode>
        <MemoryRouter
          initialEntries={["/connected?connect=pending&ticket=ticket-one"]}
        >
          <Connected />
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(completePendingConnection).toHaveBeenCalledTimes(1),
    );
    expect(completePendingConnection).toHaveBeenCalledWith("ticket-one");
  });
});
