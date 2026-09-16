// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("accepts typed text", async () => {
    render(<Textarea aria-label="ملاحظة" />);
    const el = screen.getByLabelText("ملاحظة");
    await userEvent.type(el, "منحت يدويًا");
    expect(el).toHaveValue("منحت يدويًا");
  });

  it("sets aria-invalid when invalid", () => {
    render(<Textarea aria-label="ملاحظة" invalid />);
    expect(screen.getByLabelText("ملاحظة")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
