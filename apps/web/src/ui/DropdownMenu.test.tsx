// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Button } from "./Button";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself. A plain non-interactive element, not a DropdownMenuItem — it
 *  must not join the roving-tabindex order the ArrowDown test below checks. */
function DirectionProbe() {
  const dir = useDirection();
  return <div data-testid="dir-probe">{dir}</div>;
}

function ExampleMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>إجراءات</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DirectionProbe />
        <DropdownMenuItem>تصدير CSV</DropdownMenuItem>
        <DropdownMenuItem>تصحيح التصنيف</DropdownMenuItem>
        <DropdownMenuItem disabled>حذف</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens on click and shows every item", async () => {
    render(<ExampleMenu />);
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(
      await screen.findByRole("menuitem", { name: "تصدير CSV" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "حذف" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("ArrowDown moves focus to the first item, in LTR (the default)", async () => {
    render(<ExampleMenu />);
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "تصدير CSV" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<ExampleMenu />);
    const trigger = screen.getByRole("button", { name: "إجراءات" });
    await userEvent.click(trigger);
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('under DirectionProvider dir=rtl: useDirection() inside the Portal\'s content reports "rtl", and ArrowDown still navigates the (direction-independent) roving tabindex', async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleMenu />
      </DirectionProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    await screen.findByRole("menu");
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "تصدير CSV" })).toHaveFocus();
  });
});
