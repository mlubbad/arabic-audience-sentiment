// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "../strings/ar";
import { TourContextForTests } from "./TourProvider";
import Tour, {
  CARD_ROOM,
  cardAnchorRect,
  fitSide,
  scrollBlockFor,
  sideFor,
} from "./Tour";
import { TOUR_STEPS } from "./tourSteps";
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

/** An anchor in the document with a known box: jsdom lays nothing out, so
 *  the rect is stubbed and the hole's inline style is read against it. */
function anchor(rect = { top: 100, left: 40, width: 200, height: 50 }) {
  const el = document.createElement("nav");
  el.setAttribute("data-tour", "rail");
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function renderTour(m: TourMachine) {
  return render(
    <TourContextForTests.Provider value={m}>
      <Tour />
    </TourContextForTests.Provider>,
  );
}

afterEach(() => {
  // React first, then the anchors this file appended by hand.
  cleanup();
  document.body.innerHTML = "";
});

describe("Tour — idle", () => {
  it("renders nothing", () => {
    const { container } = renderTour(machine());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("tour-welcome")).not.toBeInTheDocument();
  });
});

describe("Tour — the welcome", () => {
  it("is a dialog with the title, the body and both doors", () => {
    renderTour(machine({ status: "welcome" }));
    const dialog = screen.getByRole("dialog", { name: ar.tourWelcomeTitle });
    expect(dialog).toHaveAttribute("data-testid", "tour-welcome");
    expect(dialog).toHaveTextContent(ar.tourWelcomeBody);
    expect(screen.getByTestId("tour-start")).toHaveTextContent(ar.tourStart);
    expect(screen.getByTestId("tour-later")).toHaveTextContent(ar.tourLater);
    expect(screen.getByTestId("tour-later")).toHaveClass("ui-btn--ghost");
  });

  it("start begins, later dismisses, and the corner close is later too", async () => {
    const m = machine({ status: "welcome" });
    renderTour(m);
    await userEvent.click(screen.getByTestId("tour-start"));
    expect(m.begin).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("tour-later"));
    expect(m.later).toHaveBeenCalledTimes(1);
    // The corner ✕ carries the same name and the same meaning.
    const closes = screen.getAllByRole("button", { name: ar.tourLater });
    expect(closes).toHaveLength(2);
    await userEvent.click(
      closes.find((b) => b !== screen.getByTestId("tour-later"))!,
    );
    expect(m.later).toHaveBeenCalledTimes(2);
  });

  it("Escape on the welcome is later", async () => {
    const m = machine({ status: "welcome" });
    renderTour(m);
    await screen.findByTestId("tour-welcome");
    await userEvent.keyboard("{Escape}");
    expect(m.later).toHaveBeenCalledTimes(1);
  });
});

describe("Tour — running", () => {
  it("renders nothing while the anchor is not in the document yet", () => {
    renderTour(
      machine({ status: "running", step: TOUR_STEPS[0], anchorEl: null }),
    );
    expect(screen.queryByTestId("tour-card")).not.toBeInTheDocument();
    expect(document.querySelector(".tour-veil")).toBeNull();
  });

  it("the card on step 1: progress, title, body, no back, next, skip", async () => {
    const el = anchor();
    renderTour(
      machine({ status: "running", step: TOUR_STEPS[0], anchorEl: el }),
    );
    const card = await screen.findByTestId("tour-card");
    expect(card).toHaveAttribute("role", "dialog");
    expect(card).toHaveAttribute("aria-modal", "false");
    expect(card).toHaveAttribute("aria-labelledby", "tour-title");
    expect(card).toHaveAttribute("aria-describedby", "tour-body");
    expect(card).toHaveClass("tour-card");
    expect(screen.getByTestId("tour-progress")).toHaveTextContent(
      ar.tourProgress(1, 7),
    );
    expect(card.querySelector("h2#tour-title")).toHaveTextContent(
      ar.tourStepRailTitle,
    );
    expect(card.querySelector("p#tour-body")).toHaveTextContent(
      ar.tourStepRailBody,
    );
    expect(screen.queryByTestId("tour-back")).not.toBeInTheDocument();
    expect(screen.getByTestId("tour-next")).toHaveTextContent(ar.tourNext);
    expect(screen.getByTestId("tour-skip")).toHaveTextContent(ar.tourSkip);
    expect(screen.getByTestId("tour-skip")).toHaveClass("ui-btn--link");
    // Focus lands inside the card on each step.
    await waitFor(() =>
      expect(card).toContainElement(document.activeElement as HTMLElement),
    );
  });

  it("on the last step: back is there and next reads finish", async () => {
    const el = anchor();
    renderTour(
      machine({
        status: "running",
        index: 6,
        step: TOUR_STEPS[6],
        anchorEl: el,
      }),
    );
    await screen.findByTestId("tour-card");
    expect(screen.getByTestId("tour-progress")).toHaveTextContent("7 من 7");
    expect(screen.getByTestId("tour-back")).toHaveTextContent(ar.tourBack);
    expect(screen.getByTestId("tour-back")).toHaveClass("ui-btn--ghost");
    expect(screen.getByTestId("tour-next")).toHaveTextContent(ar.tourFinish);
  });

  it("the buttons drive the machine", async () => {
    const el = anchor();
    const m = machine({
      status: "running",
      index: 2,
      step: TOUR_STEPS[2],
      anchorEl: el,
    });
    renderTour(m);
    await userEvent.click(await screen.findByTestId("tour-next"));
    expect(m.next).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("tour-back"));
    expect(m.back).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("tour-skip"));
    expect(m.skip).toHaveBeenCalledTimes(1);
  });

  it("Escape skips", async () => {
    const el = anchor();
    const m = machine({ status: "running", step: TOUR_STEPS[0], anchorEl: el });
    renderTour(m);
    await screen.findByTestId("tour-card");
    await userEvent.keyboard("{Escape}");
    expect(m.skip).toHaveBeenCalledTimes(1);
  });

  it("the hole follows the anchor's box, inflated by 8px, and the anchor is lit", async () => {
    const el = anchor({ top: 100, left: 40, width: 200, height: 50 });
    const scroll = vi.spyOn(el, "scrollIntoView");
    const { unmount } = renderTour(
      machine({ status: "running", step: TOUR_STEPS[0], anchorEl: el }),
    );
    const veil = document.querySelector<HTMLElement>(".tour-veil");
    expect(veil).toHaveAttribute("aria-hidden", "true");
    const hole = veil!.querySelector<HTMLElement>(".tour-hole")!;
    expect(hole.style.top).toBe("92px");
    expect(hole.style.left).toBe("32px");
    expect(hole.style.width).toBe("216px");
    expect(hole.style.height).toBe("66px");
    expect(el).toHaveAttribute("data-tour-active", "");
    expect(scroll).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
    unmount();
    expect(el).not.toHaveAttribute("data-tour-active");
  });

  it("the hole is recomputed on scroll and resize", async () => {
    const box = { top: 100, left: 40, width: 200, height: 50 };
    const el = anchor(box);
    renderTour(
      machine({ status: "running", step: TOUR_STEPS[0], anchorEl: el }),
    );
    const hole = document.querySelector<HTMLElement>(".tour-hole")!;
    expect(hole.style.top).toBe("92px");
    el.getBoundingClientRect = () =>
      ({
        ...box,
        top: 300,
        y: 300,
        right: 240,
        bottom: 350,
        toJSON() {},
      }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(hole.style.top).toBe("292px"));
    el.getBoundingClientRect = () =>
      ({
        ...box,
        left: 10,
        x: 10,
        right: 210,
        bottom: 150,
        toJSON() {},
      }) as DOMRect;
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(hole.style.left).toBe("2px"));
  });

  it("the light moves from one anchor to the next", async () => {
    const first = anchor();
    const second = anchor({ top: 400, left: 0, width: 100, height: 20 });
    const m = machine({
      status: "running",
      step: TOUR_STEPS[0],
      anchorEl: first,
    });
    const { rerender } = renderTour(m);
    expect(first).toHaveAttribute("data-tour-active", "");
    rerender(
      <TourContextForTests.Provider
        value={{ ...m, index: 1, step: TOUR_STEPS[1], anchorEl: second }}
      >
        <Tour />
      </TourContextForTests.Provider>,
    );
    expect(first).not.toHaveAttribute("data-tour-active");
    expect(second).toHaveAttribute("data-tour-active", "");
    expect(document.querySelector<HTMLElement>(".tour-hole")!.style.top).toBe(
      "392px",
    );
  });

  it("scrolls without animation under reduced motion", () => {
    const el = anchor();
    const scroll = vi.spyOn(el, "scrollIntoView");
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: q.includes("reduced-motion"),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    try {
      renderTour(
        machine({ status: "running", step: TOUR_STEPS[0], anchorEl: el }),
      );
      expect(scroll).toHaveBeenCalledWith({
        block: "center",
        behavior: "auto",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps a logical placement to the physical side for the direction", () => {
    // Step 1 prefers `end`: in a right-to-left document that is the left,
    // where the page content is; in a left-to-right one, the right.
    expect(sideFor("end", "rtl", false)).toBe("left");
    expect(sideFor("end", "ltr", false)).toBe("right");
    expect(sideFor("start", "rtl", false)).toBe("right");
    expect(sideFor("start", "ltr", false)).toBe("left");
    expect(sideFor("top", "rtl", false)).toBe("top");
    expect(sideFor("bottom", "ltr", false)).toBe("bottom");
  });

  it("on a phone every card sits below its anchor", () => {
    for (const placement of ["top", "start", "end"] as const)
      expect(sideFor(placement, "rtl", true)).toBe("bottom");
  });

  it("trades a side with no room for the other, and both for below", () => {
    const viewport = { width: 1280, height: 800 };
    // The rail's nav: a thousand pixels of content to its left.
    const nav = { top: 150, left: 1029, width: 239, height: 166 };
    expect(fitSide("left", nav, viewport)).toBe("left");
    expect(fitSide("right", nav, viewport)).toBe("left");
    // A workspace card filling the content column: 16px one side, the
    // rail's 264 the other — neither holds a 360px card.
    const wide = { top: 233, left: 24, width: 968, height: 334 };
    expect(fitSide("left", wide, viewport)).toBe("bottom");
    expect(fitSide("right", wide, viewport)).toBe("bottom");
    // Top and bottom are Radix's to flip.
    expect(fitSide("top", wide, viewport)).toBe("top");
    expect(fitSide("bottom", nav, viewport)).toBe("bottom");
  });

  it("scrolls a short anchor to the middle and a tall one to the top", () => {
    const viewport = { width: 1280, height: 800 };
    const short = { top: 0, left: 0, width: 100, height: 50 };
    const edge = { ...short, height: 800 - 2 * CARD_ROOM };
    const tall = { ...short, height: 334 };
    expect(scrollBlockFor(short, viewport, "bottom")).toBe("center");
    expect(scrollBlockFor(edge, viewport, "top")).toBe("center");
    expect(scrollBlockFor(tall, viewport, "bottom")).toBe("start");
    // Beside the anchor, the card needs no room above or below it.
    expect(scrollBlockFor(tall, viewport, "left")).toBe("center");
    expect(scrollBlockFor({ ...short, height: 900 }, viewport, "right")).toBe(
      "center",
    );
  });

  it("cuts an anchor's box only when neither above nor below has room", () => {
    const viewport = { width: 1280, height: 800 };
    // A workspace card scrolled to the top: room below it.
    const atTop = { top: 24, left: 24, width: 968, height: 334 };
    expect(cardAnchorRect(atTop, viewport)).toEqual(atTop);
    // The same card left in the middle: neither side has a card's room, so
    // the box is cut to leave it at the bottom of the screen.
    const mid = { ...atTop, top: 233 };
    expect(cardAnchorRect(mid, viewport)).toEqual({
      ...mid,
      height: 800 - CARD_ROOM - 233,
    });
    // The catalogue, taller than the screen, its top scrolled past.
    const tall = { top: -40, left: 24, width: 968, height: 900 };
    expect(cardAnchorRect(tall, viewport)).toEqual({
      ...tall,
      top: 0,
      height: 800 - CARD_ROOM,
    });
    // Tall, but starting low enough that a card fits above it.
    const below = { top: 600, left: 24, width: 968, height: 900 };
    expect(cardAnchorRect(below, viewport)).toEqual(below);
  });
});
