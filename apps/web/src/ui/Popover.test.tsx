// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Button } from "./Button";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself rather than only whether the popover still opens. */
function DirectionProbe() {
  const dir = useDirection();
  return <span data-testid="dir-probe">{dir}</span>;
}

function ExamplePopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>خيارات العمود</Button>
      </PopoverTrigger>
      <PopoverContent>
        محتوى القائمة
        <DirectionProbe />
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("opens on trigger click and closes on Escape, focus returning to the trigger", async () => {
    render(<ExamplePopover />);
    const trigger = screen.getByRole("button", { name: "خيارات العمود" });
    await userEvent.click(trigger);
    expect(await screen.findByText("محتوى القائمة")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    render(
      <div>
        <ExamplePopover />
        <button type="button">خارج القائمة</button>
      </div>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "خيارات العمود" }),
    );
    await screen.findByText("محتوى القائمة");
    await userEvent.click(screen.getByRole("button", { name: "خارج القائمة" }));
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
  });

  it('under DirectionProvider dir=rtl: useDirection() inside the Portal\'s content reports "rtl", and the popover still opens/closes correctly', async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExamplePopover />
      </DirectionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "خيارات العمود" });
    await userEvent.click(trigger);
    expect(await screen.findByText("محتوى القائمة")).toBeVisible();
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
