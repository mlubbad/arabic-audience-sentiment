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
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  const goTo = useCallback((i: number) => setIndex(i), []);
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
    next,
    goTo,
    toggle,
  };
}
