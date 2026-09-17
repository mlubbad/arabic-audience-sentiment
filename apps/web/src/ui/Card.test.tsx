// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children inside a ui-card div", () => {
    render(<Card data-testid="c">محتوى</Card>);
    const el = screen.getByTestId("c");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("ui-card");
    expect(el).toHaveTextContent("محتوى");
  });

  it("asChild lends the class to the child element instead of adding a div", () => {
    render(
      <ul>
        <Card asChild className="extra">
          <li data-testid="c">عنصر</li>
        </Card>
      </ul>,
    );
    const el = screen.getByTestId("c");
    expect(el.tagName).toBe("LI");
    expect(el).toHaveClass("ui-card", "extra");
    expect(el.parentElement?.tagName).toBe("UL");
  });
});
