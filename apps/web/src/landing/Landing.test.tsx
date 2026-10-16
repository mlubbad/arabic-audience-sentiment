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
  it("renders the nine sections in order under one H1, with the three anchors reachable", () => {
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
    expect(ids).toEqual(["intro", "why", "experience", "questions"]);
    expect(container.querySelectorAll("main > section")).toHaveLength(9);
    expect(
      container.querySelectorAll("[data-testid='product-window']"),
    ).toHaveLength(2);
  });
});
