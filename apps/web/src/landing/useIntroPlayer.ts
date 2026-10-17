import { useCallback, useEffect, useRef, useState } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** The intro's playhead. It plays only while the player is on screen, never
 *  for a reader who asked for less motion, and never after the reader paused
 *  it — a moving picture longer than five seconds must be stoppable (WCAG
 *  2.2.2). The clock is not here: the active scene's progress bar is a CSS
 *  animation, and its end calls `next`, so pausing the CSS pauses the story
 *  and nothing drifts between the bar and the scene. */
export function useIntroPlayer<T extends HTMLElement>(count: number) {
  const ref = useRef<T | null>(null);
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  // The first scene's first pass. The prerendered page paints scene 1
  // complete; were its entrances to run on hydration, the hero's picture
  // would flash empty and redraw. Until the story first moves on, the scene
  // stays as painted and only the clock and the light move.
  const [fresh, setFresh] = useState(true);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCE);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const next = useCallback(() => {
    setFresh(false);
    setIndex((i) => (i + 1) % count);
  }, [count]);
  const goTo = useCallback((i: number) => {
    setFresh(false);
    setIndex(i);
  }, []);
  const toggle = useCallback(() => setPaused((p) => !p), []);

  return {
    ref,
    index,
    /** Whether the story is moving now. */
    playing: inView && !paused && !reduced,
    /** Whether the reader stopped it (the button's state). */
    paused,
    /** Reduced motion: no autoplay and no play button; the scenes are
     *  chosen by hand. */
    reduced,
    /** Still on the first pass of the first scene, as prerendered. */
    fresh,
    next,
    goTo,
    toggle,
  };
}
