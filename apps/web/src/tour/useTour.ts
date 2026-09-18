/**
 * The tour's machine — see the design doc's "Behaviour".
 *
 * Four states: `idle` (nothing rendered), `welcome` (the dialog), `running`
 * (the veil and the card on step `index`), `done` (one tick, so the layer
 * can unmount before the machine is idle again). Leaving through any door
 * writes the browser's memory (`tourState.ts`): finishing or skipping is
 * "seen", «ليس الآن» is "dismissed".
 *
 * The router is injected, not imported: `TourProvider` hands in
 * `useNavigate`/`useLocation`, and the unit test hands in a spy and a
 * location it re-renders with — the machine itself never touches
 * `window.location`. When a step's route is not the page it is on, it asks
 * for that route once (keeping `?demo=1`, dropping `?tour=1`) and waits for
 * the location to change; on the right page it polls the document for the
 * step's `data-tour` anchor every animation frame, lights it when it
 * appears, and skips the step forward when it never does — an empty
 * dashboard has no section nav, a fresh account no workspace card. The
 * `anchorWait` deadline runs from the moment the step is entered, so a
 * route that never arrives (a page that refuses the reader) skips forward
 * the same way. Browser back while running ends the tour, so a hole never
 * sits over a page the step was not written for.
 *
 * The doors are gated on the state they open from: `begin`/`later` from
 * the welcome, `next`/`back` while running, `skip` from either — a stale
 * press from a layer that is unmounting, or a double-fired handler, does
 * nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TourStep } from "./tourSteps";
import { writeTour, type TourMemory } from "./tourState";

export type TourStatus = "idle" | "welcome" | "running" | "done";

export type TourNavigate = (
  to: { pathname: string; search: string },
  options?: { replace?: boolean },
) => void;

export type UseTourOptions = {
  steps: readonly TourStep[];
  navigate: TourNavigate;
  pathname: string;
  search: string;
  /** The document the anchors live in; the page's own by default. */
  doc?: Document;
  /** How long a step waits for its anchor, once on its page, before it is
   *  skipped, in ms. */
  anchorWait?: number;
  /** How long a step waits for the route it asked for before it is
   *  skipped, in ms — a lazy chunk on a slow network takes longer than an
   *  anchor on a page that has arrived. */
  routeWait?: number;
};

export type TourMachine = {
  status: TourStatus;
  index: number;
  /** The current step while `running`; `null` otherwise. */
  step: TourStep | null;
  /** The lit element once the current step's anchor is in the document. */
  anchorEl: HTMLElement | null;
  total: number;
  /** idle → welcome, from anywhere: the rail's replay and `?tour=1`. */
  start: () => void;
  /** welcome → running at step 1: the welcome dialog's start button. */
  begin: () => void;
  /** The next step, or — on the last — the end as "seen". */
  next: () => void;
  /** The previous step, never below the first. */
  back: () => void;
  /** Ends as "seen" from anywhere: the card's skip, Escape, browser back. */
  skip: () => void;
  /** Ends as "dismissed": the welcome's «ليس الآن». */
  later: () => void;
};

const ANCHOR_WAIT_MS = 1500;
const ROUTE_WAIT_MS = 5000;

/** The search a tour navigation carries: the demo flag if it was there,
 *  never the `tour` flag (a support link that starts the tour must not
 *  restart it on every step) and nothing else — the workspace parameter is
 *  the page's to carry, and it re-derives it from storage on arrival. */
export function keepDemo(search: string): string {
  const params = new URLSearchParams(search);
  return params.has("demo") ? `?demo=${params.get("demo") ?? ""}` : "";
}

/** The same address without the `tour` flag and nothing else changed —
 *  the provider's cleanup after `?tour=1` has started the tour, on the page
 *  the reader is already on, whose own parameters stay. */
export function dropTour(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("tour");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export function useTour({
  steps,
  navigate,
  pathname,
  search,
  doc,
  anchorWait = ANCHOR_WAIT_MS,
  routeWait = ROUTE_WAIT_MS,
}: UseTourOptions): TourMachine {
  const [status, setStatus] = useState<TourStatus>("idle");
  const [index, setIndex] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const total = steps.length;
  const last = total - 1;
  const step = status === "running" ? (steps[index] ?? null) : null;
  // The step being waited on: whether its route was asked for (one request
  // per step, however many times the effect re-runs — StrictMode runs it
  // twice), whether its page has arrived (the anchor clock starts once,
  // then), and the deadline the current wait runs to — the route bound
  // from entering the step, the anchor wait from arriving on the page.
  const entered = useRef<{
    index: number;
    deadline: number;
    asked: boolean;
    arrived: boolean;
  } | null>(null);

  const goTo = useCallback((i: number) => {
    entered.current = null;
    setAnchorEl(null);
    setIndex(i);
  }, []);

  const finish = useCallback((memory: TourMemory) => {
    writeTour(memory);
    entered.current = null;
    setAnchorEl(null);
    setStatus("done");
  }, []);

  const start = useCallback(() => {
    goTo(0);
    setStatus("welcome");
  }, [goTo]);

  const begin = useCallback(() => {
    if (status !== "welcome") return;
    goTo(0);
    setStatus("running");
  }, [status, goTo]);

  const next = useCallback(() => {
    if (status !== "running") return;
    if (index >= last) finish("seen");
    else goTo(index + 1);
  }, [status, index, last, finish, goTo]);

  const back = useCallback(() => {
    if (status !== "running") return;
    if (index > 0) goTo(index - 1);
  }, [status, index, goTo]);

  const skip = useCallback(() => {
    if (status === "running" || status === "welcome") finish("seen");
  }, [status, finish]);

  const later = useCallback(() => {
    if (status === "welcome") finish("dismissed");
  }, [status, finish]);

  // `done` is one tick long: the layer sees it, unmounts, and the machine
  // is idle for the next start.
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => setStatus("idle"), 0);
    return () => clearTimeout(t);
  }, [status]);

  // The step's page, then its anchor.
  useEffect(() => {
    if (status !== "running") return;
    const current = steps[index];
    if (!current) return;
    if (entered.current?.index !== index)
      entered.current = {
        index,
        deadline: Date.now() + routeWait,
        asked: false,
        arrived: false,
      };
    const clock = entered.current;
    const advance = () => {
      if (index >= last) finish("seen");
      else goTo(index + 1);
    };
    if (current.route && current.route !== pathname) {
      if (!clock.asked) {
        clock.asked = true;
        navigate(
          { pathname: current.route, search: keepDemo(search) },
          { replace: true },
        );
      }
      // The page may never come: skip forward when the route bound runs out.
      const t = setTimeout(advance, Math.max(0, clock.deadline - Date.now()));
      return () => clearTimeout(t);
    }
    // On the step's page — from the start, or once the route it asked for
    // has arrived: the anchor's own clock starts here, whole.
    if (!clock.arrived) {
      clock.arrived = true;
      clock.deadline = Date.now() + anchorWait;
    }
    const d = doc ?? globalThis.document;
    if (!d) return;
    const view = d.defaultView;
    const raf =
      view && typeof view.requestAnimationFrame === "function"
        ? (cb: () => void) => view.requestAnimationFrame(cb)
        : (cb: () => void) => setTimeout(cb, 16);
    let cancelled = false;
    const look = () => {
      if (cancelled) return;
      const el = d.querySelector<HTMLElement>(
        `[data-tour="${current.anchor}"]`,
      );
      if (el) {
        setAnchorEl(el);
        return;
      }
      if (Date.now() >= clock.deadline) {
        advance();
        return;
      }
      raf(look);
    };
    look();
    return () => {
      cancelled = true;
    };
    // `search` is read, not watched: a search change alone (the tour flag
    // being dropped, a workspace switch) is not a page change.
  }, [
    status,
    index,
    pathname,
    steps,
    doc,
    anchorWait,
    routeWait,
    last,
    finish,
    goTo,
  ]);

  // Browser back while running: end, rather than light a stale hole.
  useEffect(() => {
    if (status !== "running") return;
    const view = (doc ?? globalThis.document)?.defaultView;
    if (!view) return;
    const onPop = () => finish("seen");
    view.addEventListener("popstate", onPop);
    return () => view.removeEventListener("popstate", onPop);
  }, [status, doc, finish]);

  return {
    status,
    index,
    step,
    anchorEl,
    total,
    start,
    begin,
    next,
    back,
    skip,
    later,
  };
}
