// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { loadStrings } from "../strings";
import { ProductWindow } from "./ProductWindow";

const rtl = (el: React.ReactElement) => (
  <DirectionProvider dir="rtl">{el}</DirectionProvider>
);

describe("ProductWindow", () => {
  it("still: four comments, four equal shares, and no control that does nothing", () => {
    const { container } = render(
      rtl(<ProductWindow mode="still" locale="ar" />),
    );
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(4);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("إيجابي: ٢٥٪"),
    );
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll(
        ".lp-dot.positive, .lp-dot.negative, .lp-dot.mixed",
      ),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        ".lp-dot:not(.positive):not(.negative):not(.mixed)",
      ),
    ).toHaveLength(1);
    // The bar draws widths, not flex ratios: four equal shares are four
    // equal widths, not four segments stretched to fill the whole bar.
    const segments = container.querySelectorAll(".pw-bar > i");
    expect(segments).toHaveLength(4);
    for (const seg of segments) expect(seg).toHaveStyle({ width: "25%" });
  });

  it("interactive: choosing a sentiment narrows the list, the bar and the count", async () => {
    const { container } = render(
      rtl(<ProductWindow mode="interactive" locale="ar" />),
    );
    await userEvent.click(screen.getByRole("tab", { name: "مختلط" }));
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/مختلط: ١٠٠٪/),
    );
    // One label at 100% is one full-width segment, not four ratios that
    // still sum to a full bar regardless of the true share.
    const mixedSegment = container.querySelector(".pw-bar > i.mixed");
    expect(mixedSegment).toHaveStyle({ width: "100%" });
    expect(container.querySelector(".pw-list")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await userEvent.click(screen.getByRole("tab", { name: "الكل" }));
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(4);
    // There are no panels — the tabs filter the list in place — so no tab
    // may claim to control one (Radix writes an `aria-controls` by default).
    for (const tab of screen.getAllByRole("tab"))
      expect(tab).not.toHaveAttribute("aria-controls");
  });

  it("uses Western digits and the ASCII percent sign in English", async () => {
    // English strings load lazily (apps/web/src/strings/index.ts) and are
    // normally fetched by PageHead before a public page mounts; a bare
    // render here has no such wrapper, so the set is fetched directly —
    // the same precondition Account.setup.test.ts uses for its English case.
    await loadStrings("en");
    render(<ProductWindow mode="still" locale="en" />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Positive: 25%"),
    );
  });
});
