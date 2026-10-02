// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ar } from "./strings/ar";
import { AdminInspectionBanner } from "./AdminInspectionBanner";
import * as adminInspectHook from "./useAdminInspection";

vi.mock("./useAdminInspection");

describe("AdminInspectionBanner", () => {
  it("renders nothing when not in inspection mode", () => {
    vi.spyOn(adminInspectHook, "useAdminInspection").mockReturnValue({
      isInspecting: false,
      workspaceId: null,
      workspaceName: null,
    });

    const { container } = render(
      <MemoryRouter>
        <AdminInspectionBanner />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders warning banner and return button when inspecting", () => {
    vi.spyOn(adminInspectHook, "useAdminInspection").mockReturnValue({
      isInspecting: true,
      workspaceId: "ws-test-123",
      workspaceName: "مطبخ ريم",
    });

    render(
      <MemoryRouter>
        <AdminInspectionBanner />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(ar.adminInspectionBadge)).toBeInTheDocument();
    expect(
      screen.getByText(ar.adminInspectionBanner("مطبخ ريم")),
    ).toBeInTheDocument();

    const returnLink = screen.getByRole("link", {
      name: ar.adminInspectionReturn,
    });
    expect(returnLink).toHaveAttribute("href", "/admin");
  });
});
