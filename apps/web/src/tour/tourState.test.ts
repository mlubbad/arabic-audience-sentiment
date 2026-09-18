/**
 * Where "seen" lives for the tour: the browser, not the account — see the
 * design doc's decision record. The same shape as `locale.test.ts` for the
 * same store style: a versioned key, a value validated on the way back in,
 * and storage that can throw without costing more than the default (never
 * auto-starting again is not a real cost; a blank screen would be).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTour, readTour, wantsTour, writeTour } from "./tourState";
import { TOUR_VERSION } from "./tourSteps";

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

beforeEach(() => {
  stubStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tour's memory", () => {
  it("uses a key that carries the version", () => {
    const map = stubStorage();
    writeTour("seen");
    expect(map.has(`tour:v${TOUR_VERSION}`)).toBe(true);
  });

  it("reads back what it wrote", () => {
    writeTour("seen");
    expect(readTour()).toBe("seen");
    writeTour("dismissed");
    expect(readTour()).toBe("dismissed");
  });

  it("is null before anything is written", () => {
    expect(readTour()).toBeNull();
  });

  it("refuses a value it does not know, so a hand-edited key reads as null", () => {
    stubStorage({ [`tour:v${TOUR_VERSION}`]: "later" });
    expect(readTour()).toBeNull();
    stubStorage({ [`tour:v${TOUR_VERSION}`]: '{"x":1}' });
    expect(readTour()).toBeNull();
  });

  it("reads as null under a different version — no migration, just a fresh start", () => {
    stubStorage({ "tour:v0": "seen", "tour:v99": "seen" });
    expect(readTour()).toBeNull();
  });

  it("clears back to null", () => {
    writeTour("seen");
    clearTour();
    expect(readTour()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    });
    expect(readTour()).toBeNull();
    expect(() => writeTour("seen")).not.toThrow();
    expect(() => clearTour()).not.toThrow();
  });

  it("answers wantsTour from the ?tour=1 query alone", () => {
    expect(wantsTour("")).toBe(false);
    expect(wantsTour("?demo=1")).toBe(false);
    expect(wantsTour("?tour=1")).toBe(true);
    expect(wantsTour("?demo=1&tour=1")).toBe(true);
    expect(wantsTour("?tour=0")).toBe(true);
  });
});
