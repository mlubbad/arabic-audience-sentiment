// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself. A plain element among the items, not a SelectItem, so it can't
 *  be picked and doesn't shift which option ArrowDown/Enter select. Only
 *  mounted while the listbox is open (SelectContent renders through a
 *  Portal that Radix keeps unmounted until then), which is exactly when the
 *  RTL test needs to read it. */
function DirectionProbe() {
  const dir = useDirection();
  return <div data-testid="dir-probe">{dir}</div>;
}

function ExampleSelect({
  onValueChange,
}: {
  onValueChange: (v: string) => void;
}) {
  return (
    <Select defaultValue="founding_partner" onValueChange={onValueChange}>
      <SelectTrigger aria-label="الخطة">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <DirectionProbe />
        <SelectItem value="founding_partner">شريك تسويقي</SelectItem>
        <SelectItem value="growth">نمو</SelectItem>
        <SelectItem value="scale">توسّع</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("shows the default value on the closed trigger", () => {
    render(<ExampleSelect onValueChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "الخطة" })).toHaveTextContent(
      "شريك تسويقي",
    );
  });

  it("opens, lists every option, and calls onValueChange on pick", async () => {
    const onValueChange = vi.fn();
    render(<ExampleSelect onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "الخطة" }));
    const growth = await screen.findByRole("option", { name: "نمو" });
    await userEvent.click(growth);
    expect(onValueChange).toHaveBeenCalledWith("growth");
  });

  it('under DirectionProvider dir=rtl: useDirection() inside the Portal\'s content reports "rtl", and ArrowDown still moves to the next (direction-independent) option', async () => {
    const onValueChange = vi.fn();
    render(
      <DirectionProvider dir="rtl">
        <ExampleSelect onValueChange={onValueChange} />
      </DirectionProvider>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "الخطة" }));
    await screen.findByRole("listbox");
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("growth");
  });
});
