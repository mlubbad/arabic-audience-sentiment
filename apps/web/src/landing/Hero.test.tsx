// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Hero } from "./Hero";
import { ar } from "../strings/ar";

describe("Hero", () => {
  it("carries the H1, the two actions, the still window and the alt sentence", () => {
    const { container } = render(
      <MemoryRouter>
        <Hero locale="ar" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "id",
      "hero-title",
    );
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpExploreDashboard) }),
    ).toHaveAttribute("href", "/dashboard");
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpSeeHow) }),
    ).toHaveAttribute("href", "#experience");
    expect(screen.getByTestId("product-window")).toHaveClass("pw--still");
    expect(screen.getByRole("figure")).toHaveTextContent(ar.lpHeroAlt);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
