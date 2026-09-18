/**
 * Whether this browser has met the onboarding tour — see the design doc's
 * decision record: "seen" lives in `localStorage`, beside the language and
 * workspace-selection preferences, not on the account. No migration, no RPC,
 * and a reader on a second device or a cleared profile meets it again, which
 * is the accepted cost of not touching the server for this.
 *
 * The key carries `TOUR_VERSION` (`tourSteps.ts`) the same way `locale.ts`
 * and `workspaceSelection.ts` carry no version at all because their shape
 * never needs to invalidate old values on its own — this one does: a future
 * redesign of the itinerary can bump the version and every browser, seen or
 * not, meets the new tour once. A key from a different version, or a value
 * this file does not recognise, reads back as `null` — the same "ask again"
 * degradation `locale.ts` uses for storage it cannot trust.
 */
import { TOUR_VERSION } from "./tourSteps";

const KEY = `tour:v${TOUR_VERSION}`;

export type TourMemory = "seen" | "dismissed";

function isTourMemory(value: unknown): value is TourMemory {
  return value === "seen" || value === "dismissed";
}

/** Storage can throw outright — a private window, a blocked origin — and a
 *  forgotten "seen" only costs one extra welcome dialog, never a blank
 *  screen. Every access is guarded. */
export function readTour(): TourMemory | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return isTourMemory(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeTour(value: TourMemory) {
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    /* Remembering is a convenience; failing to remember is not an error. */
  }
}

export function clearTour() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* Same as above: clearing is a convenience too. */
  }
}

/** `?tour=1` — a support link that replays the tour even for a browser that
 *  already dismissed or finished it. `useTour` (the machine, next task) reads
 *  this and clears the stored value before starting, so the query form works
 *  regardless of what `readTour()` currently says. */
export function wantsTour(search: string): boolean {
  return new URLSearchParams(search).has("tour");
}
