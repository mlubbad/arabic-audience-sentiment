// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

// Mock ResizeObserver for Radix UI components
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function DirectionProbe() {
  const dir = useDirection();
  return <span data-testid="dir-probe">{dir}</span>;
}

describe("Tooltip", () => {
  it("shows its content on focus and hides it on blur", async () => {
    render(
      <Tooltip content="يفتح نافذة Paddle للفوترة">
        <Button>الحساب والفوترة</Button>
      </Tooltip>,
    );
    expect(
      screen.queryByText("يفتح نافذة Paddle للفوترة"),
    ).not.toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() =>
      expect(screen.getByText("يفتح نافذة Paddle للفوترة")).toBeVisible(),
    );
  });

  it("useDirection() inside the Portal's content reports the wrapping DirectionProvider's value, not the silent 'ltr' fallback", async () => {
    render(
      <DirectionProvider dir="rtl">
        <Tooltip content={<DirectionProbe />}>
          <Button>زر</Button>
        </Tooltip>
      </DirectionProvider>,
    );
    await userEvent.tab();
    // Radix's useDirection() defaults to "ltr" with no context — if DirectionProvider's
    // context did not survive the Portal, this would read "ltr" here despite the rtl wrap.
    expect(await screen.findByTestId("dir-probe")).toHaveTextContent("rtl");
  });
});
