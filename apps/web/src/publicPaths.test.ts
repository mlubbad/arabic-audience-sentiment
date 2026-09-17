/** The public addresses: one per page per language, and no page links to
 *  a bare address that forgets the English reader. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_PATHS } from "./legal/types";
import {
  localeOfPath,
  PUBLIC_PAGES,
  PUBLIC_ROUTES,
  publicPath,
  resolvePublicPath,
} from "./publicPaths";

describe("public paths", () => {
  it("give every page an Arabic address and an English one under /en", () => {
    expect(publicPath("home", "ar")).toBe("/");
    expect(publicPath("home", "en")).toBe("/en");
    expect(publicPath("pricing", "ar")).toBe("/pricing");
    expect(publicPath("pricing", "en")).toBe("/en/pricing");
    expect(publicPath("privacy", "ar")).toBe(LEGAL_PATHS.privacy);
    expect(publicPath("terms", "en")).toBe(`/en${LEGAL_PATHS.terms}`);
  });

  it("resolve every address they write, with or without a trailing slash", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(resolvePublicPath(route.path)).toEqual({
        page: route.page,
        locale: route.locale,
      });
      expect(resolvePublicPath(`${route.path}/`)?.page).toBe(route.page);
    }
    expect(resolvePublicPath("/en/")).toEqual({ page: "home", locale: "en" });
  });

  it("resolve nothing for the product's own routes", () => {
    for (const path of ["/dashboard", "/account", "/en/dashboard", "/enx"]) {
      expect(resolvePublicPath(path), path).toBeNull();
      expect(localeOfPath(path)).toBe("ar");
    }
  });

  it("list each page exactly twice", () => {
    expect(PUBLIC_ROUTES).toHaveLength(PUBLIC_PAGES.length * 2);
    expect(new Set(PUBLIC_ROUTES.map((r) => r.path)).size).toBe(
      PUBLIC_ROUTES.length,
    );
  });
});

describe("the public pages", () => {
  const src = (file: string) =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  it("write no bare address to a page that exists in two languages", () => {
    // `to="/"` on the pricing page sends an English reader to the Arabic
    // landing. Every such link goes through `publicPath`, which knows the
    // page's language; the product's own routes (/dashboard, /account) have
    // one address and are written as they are.
    for (const file of [
      "landing/Landing.tsx",
      "public/PublicShell.tsx",
      "PricingPage.tsx",
      "LegalPage.tsx",
      "LegalLinks.tsx",
      "main.tsx",
    ]) {
      const body = src(file);
      expect(body, file).not.toMatch(/to="\/"/);
      expect(body, file).not.toMatch(/to="\/pricing"/);
      expect(body, file).not.toMatch(/to=\{LEGAL_PATHS/);
      expect(body, file).toContain("publicPath(");
    }
  });
});
