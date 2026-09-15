/**
 * Which language the interface speaks — once, for the whole product.
 *
 * The same shape as `workspaceSelection.ts`, for the same reason: a module
 * store read through `useSyncExternalStore` rather than a React context. The
 * component tests render pages without a provider, and a context without a
 * provider falls back to a default — which here would be Arabic, silently, on
 * every page whose test forgot to wrap it. A store has no provider to forget.
 *
 * Arabic is the default and is not inferred from the browser: the product is
 * Arabic-first by charter, seventy-odd browser tests locate controls by their
 * Arabic names, and a reader who wants English asks for it once. The choice is
 * a browser preference, not account data — it is kept in `localStorage` under
 * a key beside the workspace selection, and validated on the way back in, so a
 * value edited by hand can only ever cost the reader the default; it can never
 * reach the document's `lang` attribute unchecked.
 */
import { useSyncExternalStore } from "react";

export type Locale = "ar" | "en";
export const locales: readonly Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";

const KEY = "audience.locale";

let held: Locale | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as string[]).includes(value);
}

/** Storage can throw outright — a private window, a blocked origin — and a
 *  remembered preference is never worth a blank screen. Failure is Arabic. */
function readStore(): Locale | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStore(value: Locale | null) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, value);
  } catch {
    /* Remembering is a convenience; failing to remember is not an error. */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentLocale(): Locale {
  if (!loaded) {
    held = readStore();
    loaded = true;
  }
  return held ?? DEFAULT_LOCALE;
}

export function setLocale(locale: Locale) {
  if (!isLocale(locale)) return;
  held = locale;
  loaded = true;
  writeStore(locale);
  for (const listener of [...listeners]) listener();
}

/** Test seam, and the only way back to a clean module. */
export function resetLocale() {
  held = null;
  loaded = false;
  writeStore(null);
  for (const listener of [...listeners]) listener();
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, currentLocale);
}

export const direction = (locale: Locale): "rtl" | "ltr" =>
  locale === "ar" ? "rtl" : "ltr";

/** The language tag of the other choice — what the switch offers. */
export const otherLocale = (locale: Locale): Locale =>
  locale === "ar" ? "en" : "ar";

/**
 * Writes the locale onto the document, where CSS `:lang()` and the browser's
 * own bidi algorithm read it. Called from a layout effect so it lands before
 * paint — an effect that ran after paint would draw the page right-to-left
 * and then flip it.
 */
export function applyToDocument(locale: Locale, doc = globalThis.document) {
  if (!doc) return;
  doc.documentElement.lang = locale;
  doc.documentElement.dir = direction(locale);
}
