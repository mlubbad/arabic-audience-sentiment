// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Demo } from "./Demo";
import { Audience } from "./Audience";
import { ar } from "../strings/ar";

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <DirectionProvider dir="rtl">{el}</DirectionProvider>
    </MemoryRouter>,
  );

describe("Demo", () => {
  it("is the #experience section with the interactive window and the dashboard link", async () => {
    const { container } = wrap(<Demo locale="ar" />);
    expect(container.querySelector("section#experience")).toHaveAttribute(
      "aria-labelledby",
      "experience-title",
    );
    const win = screen.getByTestId("product-window");
    expect(win).toHaveClass("pw--interactive");
    await userEvent.click(within(win).getByRole("tab", { name: "سلبي" }));
    expect(win.querySelectorAll(".lp-example-comment")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpDemoLink) }),
    ).toHaveAttribute("href", "/dashboard");
  });
});

describe("Audience", () => {
  it("switches between creators and agencies with tabs", async () => {
    wrap(<Audience locale="ar" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute(
      "id",
      "audience-title",
    );
    expect(screen.getByText(ar.lpCreatorTitle)).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: ar.lpAgencies }));
    expect(screen.getByText(ar.lpAgencyTitle)).toBeVisible();
    expect(screen.queryByText(ar.lpCreatorTitle)).not.toBeInTheDocument();
  });
});
