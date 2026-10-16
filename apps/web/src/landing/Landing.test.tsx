// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Landing } from "./Landing";

vi.mock("../LanguageSwitch", () => ({
  LanguageSwitch: () => <a href="/en">English</a>,
}));
vi.mock("../PageHead", () => ({
  PageHead: () => null,
  usePublicLocale: () => {},
}));

describe("Landing", () => {
  it("renders the eight sections in order under one H1, with the three anchors reachable", () => {
    const { container } = render(
      <MemoryRouter>
        <DirectionProvider dir="rtl">
          <Landing locale="ar" />
        </DirectionProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const ids = [...container.querySelectorAll("main section[id]")].map(
      (s) => s.id,
    );
    expect(ids).toEqual(["why", "experience", "questions"]);
    expect(container.querySelectorAll("main > section")).toHaveLength(8);
    // The hero's picture is the intro; the product window is the demo's.
    expect(
      container.querySelectorAll("[data-testid='product-window']"),
    ).toHaveLength(1);
    expect(
      container.querySelector(".lp-hero [data-testid='intro-player']"),
    ).not.toBeNull();
  });
});
