// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "../strings/ar";
import { TourContextForTests } from "./TourProvider";
import { TourEntry } from "./TourEntry";
import type { TourMachine } from "./useTour";

function machine(over: Partial<TourMachine> = {}): TourMachine {
  return {
    status: "idle",
    index: 0,
    step: null,
    anchorEl: null,
    total: 7,
    start: vi.fn(),
    begin: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    skip: vi.fn(),
    later: vi.fn(),
    ...over,
  };
}

describe("TourEntry", () => {
  it("is the replay button, named in the reader's language", () => {
    render(
      <TourContextForTests.Provider value={machine()}>
        <TourEntry />
      </TourContextForTests.Provider>,
    );
    const button = screen.getByTestId("tour-replay");
    expect(button).toHaveTextContent(ar.tourReplay);
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ui-btn--ghost");
  });

  it("starts the tour and then tells the shell", async () => {
    const calls: string[] = [];
    const m = machine({ start: () => calls.push("start") });
    render(
      <TourContextForTests.Provider value={m}>
        <TourEntry onActivate={() => calls.push("activate")} />
      </TourContextForTests.Provider>,
    );
    await userEvent.click(screen.getByTestId("tour-replay"));
    expect(calls).toEqual(["start", "activate"]);
  });

  it("renders and presses harmlessly with no provider above", async () => {
    const onActivate = vi.fn();
    render(<TourEntry onActivate={onActivate} />);
    await userEvent.click(screen.getByTestId("tour-replay"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
