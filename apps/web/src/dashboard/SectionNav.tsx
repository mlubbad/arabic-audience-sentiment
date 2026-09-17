/**
 * The report's table of contents.
 *
 * `SECTIONS` is the one list that drives both this index and the page: a
 * section cannot be added to the page and forgotten in its index, or listed
 * here and never rendered, which is how "مقارنة الفيديوهات" and "أكثر
 * التعليقات السلبية تفاعلًا" once existed on the page and nowhere in the
 * navigation that claims to enumerate it.
 *
 * This bar used to be the page's second pinned pane, sitting above the
 * filter bar. Two sticky elements at the same offset fought over the same
 * strip of the viewport — see `useActiveSection`'s rootMargin note below for
 * the one that stayed pinned. This one no longer is; it sits in normal flow
 * directly under the filter bar, so `show=false` simply renders an empty bar
 * rather than an empty pinned one.
 */
import { useEffect, useState } from "react";
import type { Strings, StringKey } from "../strings";
import "./section-nav.css";

export const SECTIONS = [
  { id: "rp-summary", label: "secSummary" },
  { id: "rp-videos", label: "secVideos" },
  { id: "rp-voice", label: "secVoice" },
  { id: "rp-timing", label: "secTiming" },
  { id: "rp-people", label: "secPeople" },
  { id: "rp-compare", label: "secCompare" },
  { id: "rp-engaged", label: "secEngaged" },
  { id: "rp-comments", label: "secComments" },
] as const satisfies readonly { id: string; label: StringKey }[];

/**
 * Which section the reader is in.
 *
 * Scroll position is the wrong question — a section can be short, or the page
 * can be scrolled to its end with three sections in view. The observer answers
 * the question actually being asked: of the sections currently on screen,
 * which starts highest. `enabled` exists because the sections do not render on
 * an empty page, and an observer watching for elements that will never appear
 * is a subscription with no subject.
 */
export function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      setActive(null);
      return;
    }
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(s.id));
        // Only move the mark when something is in view. Clearing it between
        // two sections would make the index flicker on every scroll.
        if (first) setActive(first.id);
      },
      // The filter bar is the page's one sticky element now: 154.5px pinned,
      // measured at 1280×900 scrolled 1500 with no filter applied (the
      // fields' row and the actions' row; the date note left the pane), plus
      // 8px of slack — a section is "reached" when its top passes under that
      // bar, not when it touches the viewport edge. With filters applied the
      // chips add a row (223px measured); the mark then moves a little late,
      // which reads better than moving early with none applied.
      { rootMargin: "-163px 0px -55% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled]);
  return active;
}

export function SectionNav({
  active,
  S,
  show,
}: {
  active: string | null;
  S: Strings;
  show: boolean;
}) {
  return (
    <nav
      className="db-nav"
      aria-label={S.reportSectionsLabel}
      data-testid="section-nav"
    >
      {show && (
        <div className="db-nav-links">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              // Where the reader is, not only where they can go.
              aria-current={active === section.id ? "true" : undefined}
            >
              {S[section.label]}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
