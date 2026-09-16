// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children inside a ui-card div", () => {
    render(<Card data-testid="c">محتوى</Card>);
    const el = screen.getByTestId("c");
    expect(el).toHaveClass("ui-card");
    expect(el).toHaveTextContent("محتوى");
  });
});
