// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("is labelled and starts unchecked", () => {
    render(<Checkbox label="تجاوز حد الفوترة" />);
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    expect(box).not.toBeChecked();
  });

  it("toggles on click and calls onCheckedChange", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="تجاوز حد الفوترة" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles on Space when focused, per WAI-ARIA checkbox pattern", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="تجاوز حد الفوترة" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    box.focus();
    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
