// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children and the primary/md defaults", () => {
    render(<Button>احفظ</Button>);
    const btn = screen.getByRole("button", { name: "احفظ" });
    expect(btn).toHaveClass("ui-btn", "ui-btn--primary", "ui-btn--md");
  });

  it("applies the requested variant and size", () => {
    render(
      <Button variant="danger" size="lg">
        احذف
      </Button>,
    );
    expect(screen.getByRole("button", { name: "احذف" })).toHaveClass(
      "ui-btn--danger",
      "ui-btn--lg",
    );
  });

  it("offers an outline door and a link, each on its own class", () => {
    render(
      <>
        <Button variant="outline">Google</Button>
        <Button variant="link">أنشئ حسابًا</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Google" })).toHaveClass(
      "ui-btn--outline",
    );
    const link = screen.getByRole("button", { name: "أنشئ حسابًا" });
    expect(link).toHaveClass("ui-btn--link");
    // A link wearing a button's element never submits the form around it.
    expect(link).toHaveAttribute("type", "button");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>تأكيد</Button>);
    await userEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when asked, and does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        احفظ
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "احفظ" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
