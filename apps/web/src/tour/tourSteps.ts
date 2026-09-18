/**
 * The tour's fixed itinerary — see `docs/superpowers/specs/2026-09-18-onboarding-tour-design.md`.
 *
 * Seven steps across the rail and the three signed-in pages. Each step names
 * the route it plays on (`null` for step 1, which plays on whichever page the
 * tour started on — the rail is on every page, so it never needs a move),
 * the `data-tour="<anchor>"` element it lights up, which side of that element
 * its card prefers (`start`/`end` are logical, not left/right — the layer
 * that renders the card maps them for the document's direction), and the two
 * string keys its card reads. `TOUR_VERSION` is the version folded into the
 * `localStorage` key in `tourState.ts`: bump it to make every browser meet
 * the tour again after a redesign of the itinerary itself.
 */
import type { StringKey } from "../strings";

export const TOUR_VERSION = 1;

/** The phone breakpoint — the one the rail collapses at (`app.css`), so
 *  `stepsFor(phone)`, the provider's viewport watch and the card's
 *  placement all turn on the same width. */
export const TOUR_PHONE_QUERY = "(max-width: 900px)";

export type TourStepId =
  | "rail"
  | "workspace"
  | "setup"
  | "catalogue"
  | "selection"
  | "filters"
  | "sections";

export type TourStep = {
  id: TourStepId;
  route: "/account" | "/sync" | "/dashboard" | null;
  anchor: string;
  placement: "top" | "bottom" | "start" | "end";
  title: StringKey;
  body: StringKey;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "rail",
    route: null,
    anchor: "rail",
    placement: "end",
    title: "tourStepRailTitle",
    body: "tourStepRailBody",
  },
  {
    id: "workspace",
    route: "/account",
    anchor: "workspace",
    placement: "end",
    title: "tourStepWorkspaceTitle",
    body: "tourStepWorkspaceBody",
  },
  {
    id: "setup",
    route: "/account",
    anchor: "setup",
    placement: "end",
    title: "tourStepSetupTitle",
    body: "tourStepSetupBody",
  },
  {
    id: "catalogue",
    route: "/sync",
    anchor: "catalogue",
    placement: "bottom",
    title: "tourStepCatalogueTitle",
    body: "tourStepCatalogueBody",
  },
  {
    id: "selection",
    route: "/sync",
    anchor: "selection",
    placement: "top",
    title: "tourStepSelectionTitle",
    body: "tourStepSelectionBody",
  },
  {
    id: "filters",
    route: "/dashboard",
    anchor: "filters",
    placement: "bottom",
    title: "tourStepFiltersTitle",
    body: "tourStepFiltersBody",
  },
  {
    id: "sections",
    route: "/dashboard",
    anchor: "sections",
    placement: "bottom",
    title: "tourStepSectionsTitle",
    body: "tourStepSectionsBody",
  },
];

/**
 * The itinerary a running tour actually uses. On a phone (< 900px, the same
 * breakpoint the rail collapses at) there is no standing rail to point at —
 * only the menu button that opens it — so step 1 moves its anchor to
 * `"rail-menu"` and its card drops to `"bottom"`, the one placement that
 * fits under a button pinned to the top of a narrow screen. Steps 2–7 are
 * unchanged: their anchors live in the page content, which a phone still
 * has.
 */
export function stepsFor(phone: boolean): readonly TourStep[] {
  if (!phone) return TOUR_STEPS;
  const [first, ...rest] = TOUR_STEPS;
  return [{ ...first, anchor: "rail-menu", placement: "bottom" }, ...rest];
}
