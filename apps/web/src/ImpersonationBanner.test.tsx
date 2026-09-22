// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ar } from "./strings/ar";
import { ImpersonationBanner } from "./ImpersonationBanner";
import * as impersonationHook from "./impersonation";

vi.mock("./impersonation");

describe("ImpersonationBanner", () => {
  it("renders nothing when not in impersonation mode", () => {
    vi.spyOn(impersonationHook, "useImpersonation").mockReturnValue({
      isImpersonating: false,
      impersonatedUser: null,
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: vi.fn(),
    });

    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders warning banner and return button when impersonating", () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(impersonationHook, "useImpersonation").mockReturnValue({
      isImpersonating: true,
      impersonatedUser: {
        id: "target-user-123",
        email: "subscriber@example.com",
      },
      loading: false,
      startImpersonation: vi.fn(),
      stopImpersonation: stopMock,
    });

    render(<ImpersonationBanner />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(ar.adminImpersonationBanner("subscriber@example.com")),
      ),
    ).toBeInTheDocument();

    const returnBtn = screen.getByRole("button", {
      name: ar.adminImpersonationReturn,
    });
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(returnBtn);
    expect(stopMock).toHaveBeenCalled();
  });
});
