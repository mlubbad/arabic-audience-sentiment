/** The legal page, rendered — and the footers that have to reach it.
 *
 * Rendered rather than read: a document that loads, titles itself and lays
 * its sections out under their anchors is what a reviewer following the
 * landing footer sees. The footers are held to source, because what they
 * mount is a single component and the check is that each of them mounts it.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LegalPage } from "./LegalPage";
import { legalAr, LEGAL_KEYS, LEGAL_PATHS } from "./legal";
import { PUBLIC_ROUTES, publicPath } from "./publicPaths";
import { ar } from "./strings/ar";

const render = (doc: (typeof LEGAL_KEYS)[number]) =>
  renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: LEGAL_PATHS[doc] },
      createElement(LegalPage, { doc }),
    ),
  );

describe("a legal page", () => {
  it("shows the document's title, date and every section under its anchor", () => {
    for (const key of LEGAL_KEYS) {
      const html = render(key);
      const doc = legalAr[key];
      expect(html).toContain(`<h1 id="legal-title">${doc.title}</h1>`);
      expect(html).toContain(`<time dateTime="${doc.updated}">`);
      for (const s of doc.sections) {
        expect(html, `${key}.${s.id}`).toContain(`<section id="${s.id}"`);
        expect(html).toContain(`href="#${s.id}"`);
        expect(html).toContain(s.heading);
      }
    }
  });

  it("turns an inline link into an anchor that opens away from the page", () => {
    const html = render("privacy");
    expect(html).toContain(
      '<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">',
    );
    // The markup is consumed, never shown.
    expect(html).not.toMatch(/\]\(https?:/);
  });

  it("links the other document from its own foot", () => {
    const html = render("terms");
    expect(html).toContain(`href="${LEGAL_PATHS.privacy}"`);
    expect(html).toContain(ar.legalPrivacy);
  });
});

describe("the footers", () => {
  const src = (file: string) =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  it("each mount the one legal-links component", () => {
    for (const file of ["Landing.tsx", "PricingPage.tsx", "main.tsx"]) {
      const body = src(file);
      const footer = body.slice(body.lastIndexOf("<footer"));
      expect(footer, file).toContain("<LegalLinks");
    }
  });
  it("serve each document at the address the links use, in both languages", () => {
    // The routes are the one table in publicPaths.ts, mounted by main.tsx
    // through publicRoutes(); the links read the same table. So the check is
    // that the table names each document at LEGAL_PATHS, and the shell
    // mounts the table rather than writing a route of its own.
    const routes = src("main.tsx");
    expect(routes).toContain("publicRoutes({ Landing, Pricing, LegalPage }");
    expect(routes).not.toMatch(/path=\{LEGAL_PATHS/);
    for (const key of LEGAL_KEYS) {
      expect(publicPath(key, "ar")).toBe(LEGAL_PATHS[key]);
      expect(publicPath(key, "en")).toBe(`/en${LEGAL_PATHS[key]}`);
      expect(PUBLIC_ROUTES.filter((r) => r.page === key)).toHaveLength(2);
    }
  });
});
