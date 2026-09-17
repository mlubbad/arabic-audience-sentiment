// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Why } from "./Why";
import { Benefits } from "./Benefits";
import { Trust } from "./Trust";
import { ar } from "../strings/ar";

const wrap = (el: React.ReactElement) =>
  render(<MemoryRouter>{el}</MemoryRouter>);

describe("the three text sections", () => {
  it("Why keeps its id and heading and links down to the demo", () => {
    const { container } = wrap(<Why locale="ar" />);
    expect(container.querySelector("section#why")).toHaveAttribute(
      "aria-labelledby",
      "why-title",
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute(
      "id",
      "why-title",
    );
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpZoomIn) }),
    ).toHaveAttribute("href", "#experience");
  });
  it("Benefits renders three cards with their ordinals and level-3 headings", () => {
    const { container } = wrap(<Benefits locale="ar" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.getByText(ar.lpBenefit1Tag)).toBeInTheDocument();
    // The tag is the first card's, not the section's name: an unnamed
    // section is no landmark, and the h3s carry the outline.
    expect(container.querySelector("section")).not.toHaveAttribute(
      "aria-label",
    );
  });
  it("Trust keeps its labelled heading and three items", () => {
    const { container } = wrap(<Trust locale="ar" />);
    expect(
      container.querySelector("section[aria-labelledby='trust-title']"),
    ).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });
});
