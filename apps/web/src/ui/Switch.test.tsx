// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is labelled and starts off", () => {
    render(<Switch label="إشعارات البريد" />);
    expect(
      screen.getByRole("switch", { name: "إشعارات البريد" }),
    ).not.toBeChecked();
  });

  it("toggles on click", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="إشعارات البريد" onCheckedChange={onCheckedChange} />);
    await userEvent.click(
      screen.getByRole("switch", { name: "إشعارات البريد" }),
    );
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
