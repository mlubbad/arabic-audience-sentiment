/**
 * The tour's fixed itinerary: seven steps, each naming the page it belongs
 * to, the element it lights up, and the two strings it reads. This only
 * checks the itinerary's own shape — that every id is unique, that every
 * `title`/`body` key resolves in both string sets, and that the phone variant
 * swaps step 1's anchor. Whether `data-tour="…"` actually exists on the page
 * for each anchor is not this file's job: `tourSteps.ts` has no DOM to check
 * against, so that is proven by the e2e suite once the anchors land.
 */
import { describe, expect, it } from "vitest";
import {
  TOUR_STEPS,
  TOUR_VERSION,
  stepsFor,
  type TourStepId,
} from "./tourSteps";
import { ar } from "../strings/ar";
import { en } from "../strings/en";

describe("the tour's steps", () => {
  it("is versioned", () => {
    expect(TOUR_VERSION).toBe(1);
  });

  it("has exactly seven steps", () => {
    expect(TOUR_STEPS).toHaveLength(7);
  });

  it("names each step once", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("follows the spec's order", () => {
    const ids: TourStepId[] = [
      "rail",
      "workspace",
      "setup",
      "catalogue",
      "selection",
      "filters",
      "sections",
    ];
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(ids);
  });

  it("gives step 1 no route — it plays on whichever page it started on", () => {
    expect(TOUR_STEPS[0].route).toBeNull();
  });

  it("sends the remaining steps to the three signed-in pages", () => {
    const routes = TOUR_STEPS.slice(1).map((s) => s.route);
    expect(routes).toEqual([
      "/account",
      "/account",
      "/sync",
      "/sync",
      "/dashboard",
      "/dashboard",
    ]);
  });

  it("points every title and body at a key both string sets define", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title in ar, step.title).toBe(true);
      expect(step.title in en, step.title).toBe(true);
      expect(step.body in ar, step.body).toBe(true);
      expect(step.body in en, step.body).toBe(true);
      expect(typeof ar[step.title]).toBe("string");
      expect(typeof en[step.title]).toBe("string");
      expect(typeof ar[step.body]).toBe("string");
      expect(typeof en[step.body]).toBe("string");
    }
  });

  it("keeps every step body short enough to read in a coach mark", () => {
    for (const step of TOUR_STEPS) {
      expect((ar[step.body] as string).length).toBeLessThanOrEqual(160);
      expect((en[step.body] as string).length).toBeLessThanOrEqual(160);
    }
  });

  it("does not mutate the desktop list when asked for the phone one", () => {
    const desktop = TOUR_STEPS[0];
    stepsFor(true);
    expect(TOUR_STEPS[0]).toEqual(desktop);
  });

  describe("stepsFor(phone)", () => {
    it("anchors step 1 on the rail itself when there is room", () => {
      const steps = stepsFor(false);
      expect(steps[0].anchor).toBe("rail");
      expect(steps).toHaveLength(7);
    });

    it("anchors step 1 on the menu button on a phone, placed below it", () => {
      const steps = stepsFor(true);
      expect(steps[0].anchor).toBe("rail-menu");
      expect(steps[0].placement).toBe("bottom");
    });

    it("leaves steps 2 through 7 unchanged on a phone", () => {
      expect(stepsFor(true).slice(1)).toEqual(TOUR_STEPS.slice(1));
    });
  });
});
