/**
 * The `<head>` of a public page, and the language its address names.
 *
 * `PageHead` renders a `PageSeo` (from `seo.ts`) as the elements a crawler
 * and a share card read. React 19 hoists `<title>`, `<meta>` and `<link>`
 * into `<head>` wherever they are rendered, and `renderToString` emits them
 * ahead of the markup, which is what lets `scripts/prerender.mjs` write the
 * same head into static HTML that the client then hydrates. The JSON-LD
 * script is not hoisted and does not need to be: structured data is read
 * from anywhere in the document.
 *
 * `usePublicLocale` is the other half of "the URL decides the language" —
 * see `publicPaths.ts`. The page renders in the locale its route names,
 * through `useStrings(locale)`, from its first frame; this hook then writes
 * that locale onto the document and into the stored preference, so leaving
 * for the product keeps the language the reader was reading. The strings for
 * the other language may not be loaded yet when a reader arrives by a link
 * the switch did not make (back button, a pasted `/en`); the store is only
 * flipped once they are, so no surface ever shows Arabic words under
 * `lang="en"`.
 */
import { useLayoutEffect } from "react";
import {
  applyToDocument,
  currentLocale,
  setLocale,
  type Locale,
} from "./locale";
import { hasStrings, loadStrings } from "./strings";
import { jsonLdText, type PageSeo } from "./seo";

export function usePublicLocale(locale: Locale) {
  useLayoutEffect(() => {
    applyToDocument(locale);
    if (currentLocale() === locale) return;
    if (hasStrings(locale)) {
      setLocale(locale);
      return;
    }
    let active = true;
    void loadStrings(locale).then(() => {
      if (active) setLocale(locale);
    });
    return () => {
      active = false;
    };
  }, [locale]);
}

export function PageHead({ seo }: { seo: PageSeo }) {
  return (
    <>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <meta name="robots" content={seo.robots} />
      <link rel="canonical" href={seo.url} />
      {seo.alternates.map((a) => (
        <link
          key={a.hrefLang}
          rel="alternate"
          hrefLang={a.hrefLang}
          href={a.href}
        />
      ))}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={seo.siteName} />
      <meta property="og:locale" content={seo.ogLocale} />
      <meta
        property="og:locale:alternate"
        content={seo.ogLocale === "ar_AR" ? "en_US" : "ar_AR"}
      />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:url" content={seo.url} />
      <meta property="og:image" content={seo.image.url} />
      <meta property="og:image:width" content={String(seo.image.width)} />
      <meta property="og:image:height" content={String(seo.image.height)} />
      <meta property="og:image:alt" content={seo.image.alt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      <meta name="twitter:image" content={seo.image.url} />
      <meta name="twitter:image:alt" content={seo.image.alt} />
      {/* Prerendered with the same data the client hydrates from, so the
          text matches; the warning is suppressed for the one case it cannot —
          a pricing page reached by a link, whose catalogue arrives later. */}
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: jsonLdText(seo.jsonLd) }}
      />
    </>
  );
}
