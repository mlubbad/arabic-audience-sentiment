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
 * for that route (keeping `?demo=1`, dropping `?tour=1`) and waits for the
 * location to change; on the right page it polls the document for the
 * step's `data-tour` anchor every animation frame for up to `anchorWait`
 * ms, lights it when it appears, and skips the step forward when it never
 * does — an empty dashboard has no section nav, a fresh account no
 * workspace card. Browser back while running ends the tour, so a hole
 * never sits over a page the step was not written for.
 */
import { useCallback, useEffect, useState } from "react";
import type { TourStep } from "./tourSteps";
import { writeTour, type TourMemory } from "./tourState";

export type TourStatus = "idle" | "welcome" | "running" | "done";

export type TourNavigate = (to: { pathname: string; search: string }) => void;

export type UseTourOptions = {
  steps: readonly TourStep[];
  navigate: TourNavigate;
  pathname: string;
  search: string;
  /** The document the anchors live in; the page's own by default. */
  doc?: Document;
  /** How long a step waits for its anchor before it is skipped, in ms. */
  anchorWait?: number;
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

export const ANCHOR_WAIT_MS = 1500;

/** The search a tour navigation carries: the demo flag if it was there,
 *  never the `tour` flag (a support link that starts the tour must not
 *  restart it on every step) and nothing else — the workspace parameter is
 *  the page's to carry, and it re-derives it from storage on arrival. */
export function keepDemo(search: string): string {
  const params = new URLSearchParams(search);
  return params.has("demo") ? `?demo=${params.get("demo") ?? ""}` : "";
}

export function useTour({
  steps,
  navigate,
  pathname,
  search,
  doc,
  anchorWait = ANCHOR_WAIT_MS,
}: UseTourOptions): TourMachine {
  const [status, setStatus] = useState<TourStatus>("idle");
  const [index, setIndex] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const total = steps.length;
  const last = total - 1;
  const step = status === "running" ? (steps[index] ?? null) : null;

  const finish = useCallback((memory: TourMemory) => {
    writeTour(memory);
    setAnchorEl(null);
    setStatus("done");
  }, []);

  const start = useCallback(() => {
    setIndex(0);
    setAnchorEl(null);
    setStatus("welcome");
  }, []);

  const begin = useCallback(() => {
    setIndex(0);
    setAnchorEl(null);
    setStatus("running");
  }, []);

  const next = useCallback(() => {
    if (index >= last) finish("seen");
    else {
      setAnchorEl(null);
      setIndex(index + 1);
    }
  }, [index, last, finish]);

  const back = useCallback(() => {
    if (index > 0) {
      setAnchorEl(null);
      setIndex(index - 1);
    }
  }, [index]);

  const skip = useCallback(() => finish("seen"), [finish]);
  const later = useCallback(() => finish("dismissed"), [finish]);

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
    if (current.route && current.route !== pathname) {
      navigate({ pathname: current.route, search: keepDemo(search) });
      return;
    }
    const d = doc ?? globalThis.document;
    if (!d) return;
    const view = d.defaultView;
    const raf =
      view && typeof view.requestAnimationFrame === "function"
        ? (cb: () => void) => view.requestAnimationFrame(cb)
        : (cb: () => void) => setTimeout(cb, 16);
    const deadline = Date.now() + anchorWait;
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
      if (Date.now() >= deadline) {
        if (index >= last) finish("seen");
        else {
          setAnchorEl(null);
          setIndex(index + 1);
        }
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
  }, [status, index, pathname, steps, doc, anchorWait, last, finish]);

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
