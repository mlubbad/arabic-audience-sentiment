// @vitest-environment jsdom
/**
 * The tour's machine, driven without a router: `navigate` is a spy, the
 * location is a prop the test re-renders with (the way a real navigation
 * would), and the anchors are elements the test inserts into and removes
 * from jsdom under fake timers.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STEPS, TOUR_VERSION, type TourStep } from "./tourSteps";
import { dropTour, keepDemo, useTour, type TourNavigate } from "./useTour";

const KEY = `tour:v${TOUR_VERSION}`;

const REPLACE = { replace: true };

function mount(over: { pathname?: string; search?: string } = {}) {
  const navigate = vi.fn<TourNavigate>();
  const hook = renderHook(
    (props: { pathname: string; search: string }) =>
      useTour({ steps: TOUR_STEPS, navigate, ...props }),
    {
      initialProps: {
        pathname: over.pathname ?? "/dashboard",
        search: over.search ?? "",
      },
    },
  );
  return { ...hook, navigate };
}

function anchor(name: string) {
  const el = document.createElement("div");
  el.setAttribute("data-tour", name);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "Date",
    ],
  });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("keepDemo", () => {
  it("keeps demo and drops tour", () => {
    expect(keepDemo("?demo=1&tour=1")).toBe("?demo=1");
    expect(keepDemo("?tour=1")).toBe("");
    expect(keepDemo("?demo=1")).toBe("?demo=1");
    expect(keepDemo("")).toBe("");
  });

  it("drops anything else — the tour's own navigations carry only the demo flag", () => {
    expect(keepDemo("?ws=abc&demo=1")).toBe("?demo=1");
  });
});

describe("dropTour", () => {
  it("drops only tour and keeps everything else in place", () => {
    expect(dropTour("?demo=1&tour=1")).toBe("?demo=1");
    expect(dropTour("?tour=1&ws=abc")).toBe("?ws=abc");
    expect(dropTour("?ws=abc&tour=1&demo=1")).toBe("?ws=abc&demo=1");
    expect(dropTour("?tour=1")).toBe("");
    expect(dropTour("?demo=1")).toBe("?demo=1");
    expect(dropTour("")).toBe("");
  });
});

describe("useTour: the gates", () => {
  it("begin() only opens from the welcome", () => {
    const { result } = mount();
    act(() => result.current.begin());
    expect(result.current.status).toBe("idle");
  });

  it("next() and back() only act while running", () => {
    anchor("rail");
    const { result, navigate } = mount();
    act(() => result.current.next());
    expect(result.current.status).toBe("idle");
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.start());
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.status).toBe("welcome");
    expect(result.current.index).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("skip() ends as seen from the welcome and while running, not from idle", () => {
    const { result } = mount();
    act(() => result.current.skip());
    expect(result.current.status).toBe("idle");
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.start());
    act(() => result.current.skip());
    expect(result.current.status).toBe("done");
    expect(localStorage.getItem(KEY)).toBe("seen");
  });

  it("later() only acts on the welcome", () => {
    anchor("rail");
    const { result } = mount();
    act(() => result.current.later());
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.later());
    expect(result.current.status).toBe("running");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a door pressed on done does nothing until the machine is idle again", () => {
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.later());
    expect(result.current.status).toBe("done");
    act(() => result.current.begin());
    act(() => result.current.skip());
    expect(result.current.status).toBe("done");
    expect(localStorage.getItem(KEY)).toBe("dismissed");
  });
});

describe("useTour: the states", () => {
  it("is idle with no step until start(), then welcome, then running on begin()", () => {
    const { result } = mount();
    expect(result.current.status).toBe("idle");
    expect(result.current.step).toBeNull();
    expect(result.current.total).toBe(TOUR_STEPS.length);
    act(() => result.current.start());
    expect(result.current.status).toBe("welcome");
    expect(result.current.index).toBe(0);
    act(() => result.current.begin());
    expect(result.current.status).toBe("running");
    expect(result.current.index).toBe(0);
    expect(result.current.step).toEqual(TOUR_STEPS[0]);
  });

  it("start() from any state puts the welcome back at step 1 — the rail's replay", () => {
    anchor("rail");
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(20));
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => result.current.start());
    expect(result.current.status).toBe("welcome");
    expect(result.current.index).toBe(0);
    expect(result.current.anchorEl).toBeNull();
  });

  it("later() remembers dismissed and ends; done becomes idle on the next tick", () => {
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.later());
    expect(localStorage.getItem(KEY)).toBe("dismissed");
    expect(result.current.status).toBe("done");
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.status).toBe("idle");
  });

  it("skip() remembers seen and ends", () => {
    anchor("rail");
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.skip());
    expect(localStorage.getItem(KEY)).toBe("seen");
    expect(result.current.status).toBe("done");
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.status).toBe("idle");
    expect(result.current.anchorEl).toBeNull();
  });

  it("back() never goes below the first step", () => {
    anchor("rail");
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.back());
    expect(result.current.index).toBe(0);
  });

  it("next() at the last step remembers seen and ends", () => {
    const one: TourStep[] = [TOUR_STEPS[0]];
    anchor("rail");
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useTour({ steps: one, navigate, pathname: "/dashboard", search: "" }),
    );
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.anchorEl).not.toBeNull();
    act(() => result.current.next());
    expect(localStorage.getItem(KEY)).toBe("seen");
    expect(result.current.status).toBe("done");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("useTour: anchors and routes", () => {
  it("lights an anchor that is already in the document", () => {
    const rail = anchor("rail");
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.anchorEl).toBe(rail);
  });

  it("waits for an anchor that arrives late", () => {
    const { result } = mount();
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.anchorEl).toBeNull();
    expect(result.current.index).toBe(0);
    const rail = anchor("rail");
    act(() => vi.advanceTimersByTime(40));
    expect(result.current.anchorEl).toBe(rail);
  });

  it("skips forward past an anchor that never appears", () => {
    const { result, navigate } = mount({ pathname: "/account" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(1400));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.index).toBe(1);
    expect(result.current.status).toBe("running");
    // Step 2 lives on /account, where we already are: no navigation.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ends as seen when the last step's anchor never appears", () => {
    const { result } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(TOUR_STEPS.length - 1);
    act(() => vi.advanceTimersByTime(1600));
    expect(localStorage.getItem(KEY)).toBe("seen");
    expect(result.current.status).toBe("done");
  });

  it("asks for the step's route when the page is another, keeping demo and dropping tour, replacing the history entry", () => {
    anchor("rail");
    const { result, navigate, rerender } = mount({
      pathname: "/dashboard",
      search: "?demo=1&tour=1",
    });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/account", search: "?demo=1" },
      REPLACE,
    );
    expect(result.current.anchorEl).toBeNull();
    // The page arrives, with its anchor: the step lights it.
    const ws = anchor("workspace");
    rerender({ pathname: "/account", search: "?demo=1" });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.anchorEl).toBe(ws);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("asks for a route once per step, however often the effect re-runs", () => {
    anchor("rail");
    const { result, navigate, rerender } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    rerender({ pathname: "/dashboard", search: "" });
    rerender({ pathname: "/dashboard", search: "?ws=abc" });
    act(() => vi.advanceTimersByTime(500));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(result.current.index).toBe(1);
  });

  it("skips forward when the route it asked for never arrives — after the route bound, not the anchor wait", () => {
    anchor("rail");
    const { result, navigate } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    expect(navigate).toHaveBeenCalledTimes(1);
    // The anchor wait alone (1.5 s) is not enough to give up on a page.
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(3300));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(200));
    // Step 3 is on /account too: asked for again, once, with its own clock.
    expect(result.current.index).toBe(2);
    expect(result.current.status).toBe("running");
    expect(navigate).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(5100));
    expect(result.current.index).toBe(3);
    expect(navigate).toHaveBeenCalledTimes(3);
    expect(navigate).toHaveBeenLastCalledWith(
      { pathname: "/sync", search: "" },
      REPLACE,
    );
  });

  it("the anchor clock starts when the page arrives: a page that comes at 1.7 s still has its whole wait", () => {
    anchor("rail");
    const { result, rerender } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    // The router holds the old location while the account chunk loads.
    act(() => vi.advanceTimersByTime(1700));
    expect(result.current.index).toBe(1);
    rerender({ pathname: "/account", search: "" });
    // The page's first fetch: the anchor comes half a second after it.
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.index).toBe(1);
    expect(result.current.anchorEl).toBeNull();
    const ws = anchor("workspace");
    act(() => vi.advanceTimersByTime(40));
    expect(result.current.index).toBe(1);
    expect(result.current.anchorEl).toBe(ws);
  });

  it("a page that arrives without its anchor is skipped one anchor wait after arriving", () => {
    anchor("rail");
    const { result, rerender } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    act(() => vi.advanceTimersByTime(1200));
    rerender({ pathname: "/account", search: "" });
    act(() => vi.advanceTimersByTime(1400));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.index).toBe(2);
  });

  it("a step revisited with back() then next() gets a fresh clock", () => {
    anchor("rail");
    const ws = anchor("workspace");
    const { result, rerender } = mount({ pathname: "/dashboard" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => result.current.next());
    rerender({ pathname: "/account", search: "" });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.anchorEl).toBe(ws);
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.back());
    act(() => vi.advanceTimersByTime(20));
    act(() => result.current.next());
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.index).toBe(1);
    expect(result.current.anchorEl).toBe(ws);
  });

  it("does not navigate for the first step, which has no route", () => {
    anchor("rail");
    const { result, navigate } = mount({ pathname: "/sync" });
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(20));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does nothing while idle or on the welcome", () => {
    anchor("rail");
    const { result, navigate } = mount();
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.anchorEl).toBeNull();
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.anchorEl).toBeNull();
    expect(result.current.status).toBe("welcome");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a popstate while running ends the tour as seen; on the welcome it is ignored", () => {
    anchor("rail");
    const { result } = mount();
    act(() => result.current.start());
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(result.current.status).toBe("welcome");
    act(() => result.current.begin());
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(localStorage.getItem(KEY)).toBe("seen");
    expect(result.current.status).toBe("done");
  });

  it("honours an injected anchor wait", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useTour({
        steps: TOUR_STEPS,
        navigate,
        pathname: "/dashboard",
        search: "",
        anchorWait: 100,
      }),
    );
    act(() => result.current.start());
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.index).toBe(1);
  });
});
