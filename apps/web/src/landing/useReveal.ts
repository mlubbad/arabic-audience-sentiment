import { useEffect, useRef } from "react";

/** Marks a section to rise into view once, the first time it is scrolled to.
 *  Sections already on screen at mount are left alone — the hero and, on a
 *  tall screen, the one after it — so hydration never hides what the
 *  prerender already painted. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.classList.add("lp-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
