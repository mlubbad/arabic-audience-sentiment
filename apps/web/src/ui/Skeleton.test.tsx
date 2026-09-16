// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("announces itself as a status region so a screen reader knows content is loading", () => {
    render(<Skeleton aria-label="جارٍ التحميل" />);
    expect(screen.getByRole("status", { name: "جارٍ التحميل" })).toHaveClass(
      "ui-skeleton",
    );
  });

  it("applies width and height as inline styles", () => {
    render(<Skeleton aria-label="جارٍ التحميل" width={120} height="2rem" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "120px", height: "2rem" });
  });
});
