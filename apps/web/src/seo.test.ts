/** What every public page tells a search engine, held to the limits a
 *  result is displayed under — in both languages, without rendering. */
import { describe, expect, it } from "vitest";
import { fixtureCatalogue } from "./data";
import { ar } from "./strings/ar";
import { en } from "./strings/en";
import { PUBLIC_ROUTES } from "./publicPaths";
import {
  clip,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  homeSeo,
  jsonLdText,
  legalSeo,
  offersFrom,
  pricingSeo,
  TITLE_MAX,
  type PageSeo,
} from "./seo";
import { ROBOTS, SITE_URL } from "./site";

const strings = { ar, en } as const;

/** Every page, both languages, the way the routes build them. */
const pages: PageSeo[] = PUBLIC_ROUTES.map(({ page, locale }) => {
  const S = strings[locale];
  return page === "home"
    ? homeSeo(locale, S)
    : page === "pricing"
      ? pricingSeo(locale, S, fixtureCatalogue)
      : legalSeo(page, locale, S);
});

describe("every public page", () => {
  it("has a title a result can show whole, and a description that fills one", () => {
    for (const p of pages) {
      const where = `${p.locale} ${p.page}`;
      expect(p.title.length, `${where} title: ${p.title}`).toBeLessThanOrEqual(
        TITLE_MAX,
      );
      expect(p.title.length, where).toBeGreaterThan(20);
      expect(
        p.description.length,
        `${where} description: ${p.description}`,
      ).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(p.description.length, where).toBeGreaterThanOrEqual(
        DESCRIPTION_MIN,
      );
      expect(p.description).not.toMatch(/\n/);
    }
  });

  it("has one absolute canonical, and names both languages and a default", () => {
    for (const p of pages) {
      expect(p.url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(p.url.endsWith("/") && p.url !== `${SITE_URL}/`).toBe(false);
      const langs = p.alternates.map((a) => a.hrefLang);
      expect(langs).toEqual(["ar", "en", "x-default"]);
      // The page's own address is among its alternates, and the default is
      // the Arabic one — the product is Arabic-first.
      expect(p.alternates.map((a) => a.href)).toContain(p.url);
      expect(p.alternates[2].href).toBe(p.alternates[0].href);
    }
  });

  it("carries the site's one robots answer and a share image with an alt", () => {
    for (const p of pages) {
      expect(p.robots).toBe(ROBOTS);
      expect(p.image.url).toMatch(/^https:\/\/.+\.jpg$/);
      expect(p.image.width).toBe(1200);
      expect(p.image.height).toBe(630);
      expect(p.image.alt.length).toBeGreaterThan(20);
    }
  });

  it("has structured data that parses, names the site, and cannot close its own script", () => {
    for (const p of pages) {
      const text = jsonLdText(p.jsonLd);
      expect(text).not.toContain("</");
      const data = JSON.parse(text) as {
        "@context": string;
        "@graph": { "@type": string; [k: string]: unknown }[];
      };
      expect(data["@context"]).toBe("https://schema.org");
      const types = data["@graph"].map((n) => n["@type"]);
      expect(types).toContain("Organization");
      expect(types).toContain("WebSite");
      expect(types).toContain("WebPage");
      const page = data["@graph"].find((n) => n["@type"] === "WebPage")!;
      expect(page.url).toBe(p.url);
      expect(page.inLanguage).toBe(p.locale);
    }
  });
});

describe("the landing", () => {
  it("says the search phrase in the title, the description and the questions, in each language", () => {
    // The phrase a reader types. Once in each place a result is built from,
    // and in a sentence — the test is that it is there, not that it is
    // repeated.
    const phrase = { ar: "تعليقات يوتيوب", en: /youtube comment/i } as const;
    for (const locale of ["ar", "en"] as const) {
      const S = strings[locale];
      const seo = homeSeo(locale, S);
      expect(seo.title).toMatch(phrase[locale]);
      expect(seo.description).toMatch(phrase[locale]);
      expect(S.lpFaqTitle).toMatch(phrase[locale]);
      expect(`${S.lpHeroLine1} ${S.lpHeroLine2} ${S.lpHeroLine3}`).toMatch(
        phrase[locale],
      );
    }
  });

  it("lists every question with its answer, and no number that belongs to the catalogue", () => {
    for (const locale of ["ar", "en"] as const) {
      const S = strings[locale];
      expect(S.lpFaq.length % 2).toBe(0);
      expect(S.lpFaq.length / 2).toBeGreaterThanOrEqual(8);
      const faq = (
        homeSeo(locale, S).jsonLd["@graph"] as {
          "@type": string;
          mainEntity?: { name: string; acceptedAnswer: { text: string } }[];
        }[]
      ).find((n) => n["@type"] === "FAQPage")!;
      expect(faq.mainEntity).toBeDefined();
      expect(faq.mainEntity).toHaveLength(S.lpFaq.length / 2);
      faq.mainEntity!.forEach((q, i) => {
        expect(q.name).toBe(S.lpFaq[i * 2]);
        expect(q.acceptedAnswer.text).toBe(S.lpFaq[i * 2 + 1]);
      });
      // Prices are the catalogue's to state, never the landing's.
      for (const line of S.lpFaq) expect(line).not.toMatch(/\$|\d+\s*دولار/);
    }
  });

  it("makes no claim the beta cannot back", () => {
    for (const locale of ["ar", "en"] as const) {
      const S = strings[locale];
      const all = [
        S.lpTitle,
        S.lpDescription,
        S.lpHeroLead,
        S.lpWhyLead,
        ...S.lpFaq,
      ].join(" ");
      // No accuracy figure, no customer count: the FAQ says neither exists.
      expect(all).not.toMatch(/\d+\s*%\s*(accuracy|دقة)/i);
      expect(all).not.toMatch(/\d[\d,]*\+?\s*(customers|creators|عميل|قناة)/i);
    }
  });
});

describe("the pricing page", () => {
  it("offers exactly the self-serve plans, at the monthly price, in the page's language", () => {
    const offers = offersFrom(fixtureCatalogue, "en");
    expect(offers.map((o) => o.name)).toEqual([
      "Free",
      "Creator",
      "Creator Plus",
      "Agency",
    ]);
    expect(offers.map((o) => o.price)).toEqual([
      "0.00",
      "12.00",
      "29.00",
      "99.00",
    ]);
    for (const o of offers) {
      expect(o.priceCurrency).toBe("USD");
      // Google's test refused a priceSpecification here; none is written.
      expect("priceSpecification" in o).toBe(false);
    }
    expect(offersFrom(fixtureCatalogue, "ar").map((o) => o.name)).toEqual([
      "مجاني",
      "منشئ",
      "منشئ بلس",
      "وكالة",
    ]);
  });

  it("carries the offers only when it has the catalogue", () => {
    const app = (locale: "ar" | "en", catalogue = fixtureCatalogue) =>
      (
        pricingSeo(locale, strings[locale], catalogue).jsonLd["@graph"] as {
          "@type": string;
          offers?: unknown[];
        }[]
      ).find((n) => n["@type"] === "SoftwareApplication")!;
    expect(app("ar").offers).toHaveLength(4);
    expect(app("en", []).offers).toBeUndefined();
  });
});

describe("clip", () => {
  it("leaves a short text alone and cuts a long one at a word", () => {
    expect(clip("short")).toBe("short");
    const long = "word ".repeat(60).trim();
    const cut = clip(long, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});
