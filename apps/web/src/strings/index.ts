/** The strings for a locale, and the hook a component reads them through. */
import { useLocale, type Locale } from "../locale";
import { ar, type Strings } from "./ar";
import { en } from "./en";

export type { Strings };

/** The keys whose value is a plain sentence — what a table of labels may
 *  point at. Counted sentences are functions and are called by name. */
export type StringKey = {
  [K in keyof Strings]: Strings[K] extends string ? K : never;
}[keyof Strings];

const all: Record<Locale, Strings> = { ar, en };

export function stringsFor(locale: Locale): Strings {
  return all[locale];
}

/** The current locale's strings. `S.signIn`, `S.commentsRead(n)` — typed,
 *  so a key that does not exist is a compile error at the call site. */
export function useStrings(): Strings {
  return all[useLocale()];
}
