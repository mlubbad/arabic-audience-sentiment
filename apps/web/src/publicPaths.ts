/**
 * The public pages, and the address each one has in each language.
 *
 * Signed out, a reader meets four pages: the landing, the pricing page and
 * the two legal documents. Each exists twice — Arabic at its bare path,
 * English under `/en` — because a search engine cannot index a language it
 * cannot address: the interface language used to live in `localStorage`
 * only, so `/` was one document that happened to render in two languages
 * and there was no English page to link, cite or mark as an alternate.
 *
 * Inside the product the language stays a browser preference (`locale.ts`);
 * those routes are `noindex` and have no second address. The rule is only
 * that a public page's URL decides its language, and reading one sets the
 * preference so the product opens in the language the reader was reading.
 *
 * Every link to a public page, in either surface, goes through `publicPath`.
 * A literal "/" or "/pricing" in a component is a link that forgets the
 * English reader — `publicPaths.test.ts` sweeps the public pages for them.
 */
import type { Locale } from "./locale";
import { LEGAL_PATHS } from "./legal/types";

export type PublicPage = "home" | "pricing" | "privacy" | "terms";

export const PUBLIC_PAGES: readonly PublicPage[] = [
  "home",
  "pricing",
  "privacy",
  "terms",
];

/** The Arabic address of each page; English is the same under `/en`. */
const BASE: Readonly<Record<PublicPage, string>> = {
  home: "/",
  pricing: "/pricing",
  privacy: LEGAL_PATHS.privacy,
  terms: LEGAL_PATHS.terms,
};

export const EN_PREFIX = "/en";

export function publicPath(page: PublicPage, locale: Locale): string {
  const base = BASE[page];
  if (locale === "ar") return base;
  return base === "/" ? EN_PREFIX : `${EN_PREFIX}${base}`;
}

/** Which public page an address names, if any, and in which language. A
 *  trailing slash is tolerated on the way in — a host may add one — and
 *  never written on the way out. */
export function resolvePublicPath(
  pathname: string,
): { page: PublicPage; locale: Locale } | null {
  let path = pathname.replace(/\/+$/, "") || "/";
  let locale: Locale = "ar";
  if (path === EN_PREFIX || path.startsWith(`${EN_PREFIX}/`)) {
    locale = "en";
    path = path.slice(EN_PREFIX.length) || "/";
  }
  const page = PUBLIC_PAGES.find((p) => BASE[p] === path);
  return page ? { page, locale } : null;
}

/** The language an address asks for: `/en…` is English, anything else is
 *  Arabic. For the product's own routes this is always Arabic, which is why
 *  callers ask `resolvePublicPath` first and use this only on a hit. */
export const localeOfPath = (pathname: string): Locale =>
  resolvePublicPath(pathname)?.locale ?? "ar";

/** Every public address, both languages — what the sitemap and the
 *  prerender walk. */
export const PUBLIC_ROUTES: readonly {
  page: PublicPage;
  locale: Locale;
  path: string;
}[] = PUBLIC_PAGES.flatMap((page) =>
  (["ar", "en"] as const).map((locale) => ({
    page,
    locale,
    path: publicPath(page, locale),
  })),
);
