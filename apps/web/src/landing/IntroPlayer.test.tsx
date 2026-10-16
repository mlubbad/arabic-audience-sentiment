// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { IntroPlayer } from "./IntroPlayer";
import { ar } from "../strings/ar";

const wrap = () =>
  render(
    <MemoryRouter>
      <IntroPlayer locale="ar" />
    </MemoryRouter>,
  );

const steps = () =>
  within(screen.getByRole("list", { name: ar.lpIntroScenesLabel }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-current"));

/** The end of a CSS animation, as React hears it here. React picks the
 *  event name once, at load: jsdom has no `AnimationEvent`, so React listens
 *  for the prefixed `webkitAnimationEnd` (a browser gets `animationend`). */
const animationEnd = (el: Element) =>
  fireEvent(el, new Event("webkitAnimationEnd", { bubbles: true }));

/** The active scene's progress bar — the intro's clock. */
const clock = (container: HTMLElement) =>
  container.querySelector(".ix-progress .is-on i") as HTMLElement;

describe("IntroPlayer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a captioned figure whose four steps are text, with the stage hidden as a picture", () => {
    const { container } = wrap();
    // The hero's keyword sentence stays the figure's caption.
    expect(screen.getByRole("figure")).toHaveTextContent(ar.lpHeroAlt);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(screen.getByText(ar.lpIntroScene4)).toBeInTheDocument();
    expect(container.querySelector(".ix-stage")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(steps()).toEqual(["step", null, null, null]);
  });

  it("keeps the first scene as painted until the story first moves on", () => {
    const { container } = wrap();
    const player = screen.getByTestId("intro-player");
    // Prerendered complete: no entrance may blank it on hydration.
    expect(player).toHaveAttribute("data-fresh");
    animationEnd(clock(container));
    expect(player).not.toHaveAttribute("data-fresh");
  });

  it("is no longer fresh once a scene is chosen by hand", () => {
    wrap();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(ar.lpIntroScene1Title) }),
    );
    expect(screen.getByTestId("intro-player")).not.toHaveAttribute(
      "data-fresh",
    );
  });

  it("moves to the next scene when the active bar runs out, and loops", () => {
    const { container } = wrap();
    for (const expected of [1, 2, 3]) {
      animationEnd(clock(container));
      expect(
        container.querySelector(`.ix-scene--${expected + 1}`),
      ).not.toBeNull();
    }
    expect(steps()).toEqual([null, null, null, "step"]);
    animationEnd(clock(container));
    expect(container.querySelector(".ix-scene--1")).not.toBeNull();
  });

  it("ignores an animation that ends inside the bar, not on it", () => {
    const { container } = wrap();
    const child = document.createElement("b");
    clock(container).appendChild(child);
    animationEnd(child);
    expect(steps()).toEqual(["step", null, null, null]);
  });

  it("jumps to a scene from the list", () => {
    const { container } = wrap();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(ar.lpIntroScene3Title) }),
    );
    expect(steps()).toEqual([null, null, "step", null]);
    expect(container.querySelector(".ix-scene--3")).not.toBeNull();
    // The comparison draws one split bar per example video.
    expect(container.querySelectorAll(".ix-bar")).toHaveLength(3);
  });

  it("can be paused and played again", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: ar.lpIntroPause }));
    expect(screen.getByTestId("intro-player")).toHaveAttribute(
      "data-playing",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: ar.lpIntroPlay }));
    expect(
      screen.getByRole("button", { name: ar.lpIntroPause }),
    ).toBeInTheDocument();
  });

  it("keeps the authored comments in Arabic in either interface language", () => {
    const { container } = wrap();
    const bubbles = container.querySelectorAll(".ix-bubble");
    expect(bubbles).toHaveLength(4);
    bubbles.forEach((b) => expect(b).toHaveAttribute("lang", "ar"));
  });

  it("does not play for a reader who asked for less motion, and offers no play button", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    wrap();
    expect(screen.getByTestId("intro-player")).toHaveAttribute(
      "data-playing",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: ar.lpIntroPause }),
    ).not.toBeInTheDocument();
    // The scenes are still reachable by hand.
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(ar.lpIntroScene2Title) }),
    );
    expect(steps()).toEqual([null, "step", null, null]);
  });
});
