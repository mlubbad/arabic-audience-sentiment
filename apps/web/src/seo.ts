/**
 * What a public page tells a search engine, decided away from the page.
 *
 * Every value here is derived — from the strings, the public paths, the site
 * constants and, for the pricing page, the plan catalogue — so a test can
 * hold the whole set to the limits that matter (a title under 60 characters,
 * a description under 160, one canonical, three alternates, structured data
 * that parses) without rendering anything. `PageHead.tsx` turns one `PageSeo`
 * into `<head>` elements and a JSON-LD script; `scripts/prerender.mjs`
 * writes the same thing into static HTML.
 *
 * No price is written here. The pricing page's offers are read from the same
 * catalogue rows the cards are, and the landing's structured data names the
 * product and its questions without a number in it.
 */
import type { Plan } from "@sentiment/contracts";
import type { Locale } from "./locale";
import type { Strings } from "./strings";
import { legalFor, type LegalKey } from "./legal";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  ORGANIZATION_URL,
  ROBOTS,
  SITE_URL,
} from "./site";
import { publicPath, type PublicPage } from "./publicPaths";

export type Alternate = { hrefLang: "ar" | "en" | "x-default"; href: string };

export type PageSeo = {
  page: PublicPage;
  locale: Locale;
  /** The `<title>` and `og:title`. */
  title: string;
  /** The meta description and `og:description`. */
  description: string;
  /** Absolute; the canonical and `og:url`. */
  url: string;
  alternates: Alternate[];
  robots: string;
  image: { url: string; width: number; height: number; alt: string };
  siteName: string;
  ogLocale: "ar_AR" | "en_US";
  jsonLd: Record<string, unknown>;
};

/** The limits a result is measured against — Google's typical display
 *  widths, in characters. A longer title is cut mid-word in the result. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;
export const DESCRIPTION_MIN = 70;

export const absolute = (path: string) => `${SITE_URL}${path}`;

export function alternates(page: PublicPage): Alternate[] {
  const ar = absolute(publicPath(page, "ar"));
  const en = absolute(publicPath(page, "en"));
  // Arabic is the default for a reader whose language matches neither: the
  // product is Arabic-first by charter, and `x-default` says so.
  return [
    { hrefLang: "ar", href: ar },
    { hrefLang: "en", href: en },
    { hrefLang: "x-default", href: ar },
  ];
}

/** A description cut to the limit at a word, with an ellipsis, when the text
 *  it comes from — a legal document's lead — was written for the page and not
 *  for the result. */
export function clip(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > max / 2 ? at : cut.length).replace(/[،,;:—-]$/, "")}…`;
}

/** JSON-LD inside a `<script>`: a `<` in a string must not be able to close
 *  the element. Every `<` is escaped in the JSON text itself, which is still
 *  the same JSON when parsed. */
export const jsonLdText = (data: Record<string, unknown>) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

const languageOf = (locale: Locale) => (locale === "ar" ? "ar" : "en");

function organization(S: Strings) {
  return {
    "@type": "Organization",
    "@id": `${ORGANIZATION_URL}/#organization`,
    name: S.brandOwnerName,
    url: ORGANIZATION_URL,
  };
}

function website(locale: Locale, S: Strings) {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: S.brand,
    inLanguage: languageOf(locale),
    publisher: { "@id": `${ORGANIZATION_URL}/#organization` },
  };
}

function webPage(
  seo: Pick<PageSeo, "url" | "title" | "description" | "locale">,
  extra: Record<string, unknown> = {},
) {
  return {
    "@type": "WebPage",
    "@id": `${seo.url}#webpage`,
    url: seo.url,
    name: seo.title,
    description: seo.description,
    inLanguage: languageOf(seo.locale),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    ...extra,
  };
}

/** The landing's questions and answers, read in pairs the way the page
 *  reads them, as a `FAQPage` — the one rich result a page like this can
 *  earn, and the one that makes the honest answers visible in the result. */
function faq(S: Strings) {
  const pairs: { q: string; a: string }[] = [];
  for (let i = 0; i + 1 < S.lpFaq.length; i += 2)
    pairs.push({ q: S.lpFaq[i], a: S.lpFaq[i + 1] });
  return {
    "@type": "FAQPage",
    mainEntity: pairs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

function application(locale: Locale, S: Strings) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: S.brand,
    url: `${SITE_URL}/`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: languageOf(locale),
    description: S.lpDescription,
    featureList: [S.lpValue1, S.lpValue2, S.lpValue3, S.lpValue4],
    publisher: { "@id": `${ORGANIZATION_URL}/#organization` },
  };
}

function image(S: Strings) {
  return {
    url: absolute(OG_IMAGE_PATH),
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    alt: S.lpHeroAlt,
  };
}

const common = (page: PublicPage, locale: Locale, S: Strings) => ({
  page,
  locale,
  url: absolute(publicPath(page, locale)),
  alternates: alternates(page),
  robots: ROBOTS,
  image: image(S),
  siteName: S.brand,
  ogLocale: locale === "ar" ? ("ar_AR" as const) : ("en_US" as const),
});

export function homeSeo(locale: Locale, S: Strings): PageSeo {
  const base = common("home", locale, S);
  const title = S.lpTitle;
  const description = S.lpDescription;
  return {
    ...base,
    title,
    description,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        organization(S),
        website(locale, S),
        application(locale, S),
        webPage(
          { ...base, title, description },
          { about: { "@id": `${SITE_URL}/#app` } },
        ),
        faq(S),
      ],
    },
  };
}

/** The offers, from the catalogue the cards read. Only a plan a reader can
 *  buy or start on the page is an offer; a plan quoted on request has no
 *  price to state, and a `0` that is not for sale is not "free". */
export function offersFrom(catalogue: readonly Plan[], locale: Locale) {
  return catalogue
    .filter((p) => p.self_serve)
    .map((p) => ({
      "@type": "Offer",
      name: locale === "ar" ? p.title_ar : p.title_en,
      price: (p.price_monthly_cents / 100).toFixed(2),
      priceCurrency: "USD",
      // Per month; the yearly figure is the same plan on a different term,
      // not a second product.
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (p.price_monthly_cents / 100).toFixed(2),
        priceCurrency: "USD",
        // Tax-external, as the pricing page says: Paddle adds the buyer's tax.
        valueAddedTaxIncluded: false,
        billingDuration: 1,
        billingIncrement: 1,
        unitCode: "MON",
      },
      availability: "https://schema.org/InStock",
      url: absolute(publicPath("pricing", locale)),
    }));
}

export function pricingSeo(
  locale: Locale,
  S: Strings,
  catalogue: readonly Plan[] = [],
): PageSeo {
  const base = common("pricing", locale, S);
  const title = `${S.pricingHeading} — ${S.brand}`;
  const description = S.pricingDescription;
  const offers = offersFrom(catalogue, locale);
  return {
    ...base,
    title,
    description,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        organization(S),
        website(locale, S),
        {
          ...application(locale, S),
          ...(offers.length ? { offers } : {}),
        },
        webPage(
          { ...base, title, description },
          { about: { "@id": `${SITE_URL}/#app` } },
        ),
      ],
    },
  };
}

export function legalSeo(key: LegalKey, locale: Locale, S: Strings): PageSeo {
  const doc = legalFor(locale)[key];
  const base = common(key, locale, S);
  const title = `${doc.title} — ${S.brand}`;
  const description = clip(doc.lead);
  return {
    ...base,
    title,
    description,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        organization(S),
        website(locale, S),
        webPage({ ...base, title, description }, { dateModified: doc.updated }),
      ],
    },
  };
}
