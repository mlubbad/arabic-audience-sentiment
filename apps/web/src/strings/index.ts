/** The strings for a locale, and the hook a component reads them through.
 *
 * Arabic is in the main bundle; it is the default and every reader needs it.
 * English is loaded when asked for — by the shell before its first render when
 * the stored choice is English, and by the switch before it flips the locale
 * — so a visitor who never asks for it never downloads it. Measured: with both
 * sets in the main chunk it grew by 69 kB (22 kB gzipped) for a page most
 * visitors read in Arabic.
 *
 * `stringsFor` is synchronous and answers with the set it has. It falls back
 * to Arabic only if English is asked for before `loadStrings` resolved, which
 * the two callers above make impossible in the product; the fallback exists so
 * a test that forgets to load is wrong in an obvious way rather than crashing.
 */
import { useSyncExternalStore } from "react";
import { useLocale, type Locale } from "../locale";
import { ar, type Strings } from "./ar";

export type { Strings };

/** The keys whose value is a plain sentence — what a table of labels may
 *  point at. Counted sentences are functions and are called by name. */
export type StringKey = {
  [K in keyof Strings]: Strings[K] extends string ? K : never;
}[keyof Strings];

const loaded: Partial<Record<Locale, Strings>> = { ar };
const pending: Partial<Record<Locale, Promise<Strings>>> = {};
const listeners = new Set<() => void>();

export function loadStrings(locale: Locale): Promise<Strings> {
  const have = loaded[locale];
  if (have) return Promise.resolve(have);
  const inFlight = pending[locale];
  if (inFlight) return inFlight;
  const load = import("./en").then((m) => {
    loaded.en = m.en;
    delete pending.en;
    for (const listener of [...listeners]) listener();
    return m.en;
  });
  pending[locale] = load;
  return load;
}

export function stringsFor(locale: Locale): Strings {
  return loaded[locale] ?? ar;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current locale's strings. `S.signIn`, `S.commentsRead(n)` — typed,
 *  so a key that does not exist is a compile error at the call site. */
export function useStrings(): Strings {
  const locale = useLocale();
  return useSyncExternalStore(
    subscribe,
    () => stringsFor(locale),
    () => stringsFor(locale),
  );
}
