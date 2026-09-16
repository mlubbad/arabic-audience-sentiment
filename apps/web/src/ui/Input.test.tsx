// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

describe("Input", () => {
  it("accepts typed text", async () => {
    render(<Input aria-label="اسم مساحة العمل" />);
    const el = screen.getByLabelText("اسم مساحة العمل");
    await userEvent.type(el, "قناتي");
    expect(el).toHaveValue("قناتي");
  });

  it("sets aria-invalid and the error class when invalid", () => {
    render(<Input aria-label="البريد" invalid />);
    const el = screen.getByLabelText("البريد");
    expect(el).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves aria-invalid unset by default", () => {
    render(<Input aria-label="البريد" />);
    expect(screen.getByLabelText("البريد")).not.toHaveAttribute("aria-invalid");
  });
});
