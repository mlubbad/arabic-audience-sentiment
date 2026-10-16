// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Hero } from "./Hero";
import { ar } from "../strings/ar";

describe("Hero", () => {
  it("carries the H1, the two actions, the intro player and the alt sentence", () => {
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
    // The intro is the hero's picture; the product window lives in the demo.
    expect(screen.getByTestId("intro-player")).toBeInTheDocument();
    expect(screen.queryByTestId("product-window")).not.toBeInTheDocument();
    expect(screen.getByRole("figure")).toHaveTextContent(ar.lpHeroAlt);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText(ar.lpHeroCaption)).toBeInTheDocument();
  });
});
