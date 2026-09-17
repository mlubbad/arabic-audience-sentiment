import { useEffect, useState } from "react";

/**
 * A media query as a boolean, kept live across resizes and orientation
 * changes. Guarded for SSR/prerender (no `window`) and for a test
 * environment that has no `matchMedia` at all — jsdom does not implement
 * it, so a test that never stubs it gets the "not compact" answer rather
 * than a thrown error.
 */
export function useMediaQuery(query: string): boolean {
  const supported = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [matches, setMatches] = useState(() =>
    supported() ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (!supported()) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
