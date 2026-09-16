// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { useDirection } from "@radix-ui/react-direction";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
import { Button } from "./Button";

/** Reports the `Direction` context it actually reads, from inside whatever
 *  rendered it — used only by the RTL test below. Radix's `useDirection()`
 *  falls back to `"ltr"` silently when no context is found (it never
 *  throws), so a test that only checks "did the dialog still open" would
 *  pass identically whether or not `DirectionProvider`'s value survived the
 *  `Portal`. This probe checks the value itself, not a proxy for it. */
function DirectionProbe() {
  const dir = useDirection();
  return <span data-testid="dir-probe">{dir}</span>;
}

function ExampleDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>منح حزمة</Button>
      </DialogTrigger>
      <DialogContent closeLabel="إغلاق">
        <DialogTitle>تأكيد منح الحزمة</DialogTitle>
        <DialogDescription>لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
        <button type="button">أول عنصر قابل للتركيز</button>
        <DirectionProbe />
        <DialogClose asChild>
          <Button variant="secondary">إلغاء</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is closed until the trigger opens it, and focus moves inside", async () => {
    render(<ExampleDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    const dialog = await screen.findByRole("dialog", {
      name: "تأكيد منح الحزمة",
    });
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<ExampleDialog />);
    const trigger = screen.getByRole("button", { name: "منح حزمة" });
    await userEvent.click(trigger);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes when DialogClose is activated", async () => {
    render(<ExampleDialog />);
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("labels the built-in close button from closeLabel, bilingually meaningful", async () => {
    render(<ExampleDialog />);
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    expect(
      await screen.findByRole("button", { name: "إغلاق" }),
    ).toBeInTheDocument();
  });

  it('under DirectionProvider dir=rtl: useDirection() inside the Portal\'s content reports "rtl", not the silent "ltr" fallback, and the mechanics (focus trap, Escape close, focus return) still work', async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleDialog />
      </DirectionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "منح حزمة" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("as a sheet, marks itself so the stylesheet can anchor it to the inline-start edge", () => {
    render(
      <DirectionProvider dir="rtl">
        <Dialog open>
          <DialogContent
            variant="sheet"
            closeLabel="إغلاق"
            aria-describedby={undefined}
          >
            <DialogTitle>القائمة</DialogTitle>
          </DialogContent>
        </Dialog>
      </DirectionProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-variant", "sheet");
    expect(dialog).toHaveClass("ui-dialog-content--sheet");
  });

  it("defaults to the centred variant", () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="إغلاق" aria-describedby={undefined}>
          <DialogTitle>عنوان</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-variant",
      "center",
    );
  });
});
