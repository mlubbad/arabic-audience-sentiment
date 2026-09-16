/**
 * Prerender the public pages into static HTML, after `vite build`.
 *
 * The app is client-rendered: `dist/index.html` is a template with an empty
 * `<div id="root">`, and a crawler that does not run JavaScript — or a share
 * card, which never does — sees a page with no words on it. This script
 * builds a server bundle of `src/entry-prerender.tsx`, renders each public
 * address (`PUBLIC_ROUTES`: the landing, the pricing page and the two legal
 * documents, in Arabic and in English) and writes the result over the
 * template, head and all. `main.tsx` finds the markup in place and hydrates
 * it instead of rendering from nothing.
 *
 * What it writes into `dist/`:
 *
 *   app.html                 the untouched template — the SPA fallback for
 *                            every route that is not a public page
 *   index.html               `/`, prerendered
 *   <path>/index.html        every other public address, prerendered
 *   sitemap.xml              the public addresses with their alternates
 *   robots.txt               open with the sitemap when the site is public,
 *                            `Disallow: /` otherwise
 *   .htaccess                the `X-Robots-Tag` line removed when public
 *
 * `.htaccess` serves `<path>/index.html` for `/<path>` without a redirect,
 * and `app.html` for anything that is not a file, a directory or a
 * prerendered page. `VITE_SITE_PUBLIC` (see `src/site.ts`) is the one flag
 * behind `robots.txt`, the header and every page's robots meta.
 *
 * The pricing page is rendered with the plan catalogue: the live rows when
 * the build is configured for a Supabase project and it answers, the fixture
 * (the same six rows the migration inserts) when it is not — and says which.
 * The rows are also embedded in the page as JSON so the hydrated page starts
 * from what the static HTML showed, then refetches.
 *
 * Every output is checked before the script exits 0: a public page that lost
 * its `<h1>`, its canonical, its structured data or its language is a build
 * failure, not a surprise in a search console three weeks later.
 */
import { build } from "vite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ssrOut = join(root, "dist-prerender");
const template = join(dist, "index.html");

if (!existsSync(template)) {
  console.error("prerender: no dist/index.html — run `vite build` first");
  process.exit(1);
}

await build({
  root,
  configFile: join(root, "vite.config.ts"),
  logLevel: "warn",
  build: {
    ssr: "src/entry-prerender.tsx",
    outDir: ssrOut,
    emptyOutDir: true,
    // The client build already wrote `dist/`; nothing from this one is
    // served, so it must not touch that directory.
    manifest: false,
    copyPublicDir: false,
  },
});

const entry = await import(pathToFileURL(join(ssrOut, "entry-prerender.js")));
const { PUBLIC_ROUTES, SITE_PUBLIC, SITE_URL, EMBEDDED_CATALOGUE_ID } = entry;

// The catalogue, from the project the build is configured for when it
// answers, from the fixture when it does not. Said either way: a pricing page
// prerendered with fixture prices on a live build is worth knowing about.
let catalogue;
let catalogueSource;
try {
  catalogue = await entry.readCatalogue();
  catalogueSource = "read at build time";
} catch (error) {
  catalogue = entry.fixtureCatalogue;
  catalogueSource = `fixture (live read failed: ${error?.message ?? error})`;
}
console.log(
  `prerender: catalogue ${catalogueSource}, ${catalogue.length} plans`,
);

const original = readFileSync(template, "utf8");
if (!original.includes('<div id="root"></div>'))
  throw new Error("prerender: template has no empty #root to fill");
// The SPA fallback keeps the template exactly, plus the one directive the
// shell's pages carry: nothing under the shell is ever indexed.
writeFileSync(
  join(dist, "app.html"),
  original.replace(
    "</head>",
    '<meta name="robots" content="noindex, nofollow"/></head>',
  ),
);

/** JSON in a `<script>`: `<` cannot be allowed to close the element. */
const embed = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

const written = [];
for (const route of PUBLIC_ROUTES) {
  const rendered = await entry.render(route.path, catalogue);
  const { html, locale } = rendered;
  // React writes the prop's name; the attribute's is lower-case. A parser
  // folds it either way, and the client hydrates against the DOM, not the
  // text — so the file can carry the spelling a validator expects.
  const head = rendered.head.replace(/\bhrefLang=/g, "hreflang=");
  const dir = locale === "ar" ? "rtl" : "ltr";
  let page = original
    .replace(/<html[^>]*>/, `<html lang="${locale}" dir="${dir}">`)
    .replace("</head>", `${head}</head>`)
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
  if (route.page === "pricing")
    page = page.replace(
      "</head>",
      `<script id="${EMBEDDED_CATALOGUE_ID}" type="application/json">${embed(catalogue)}</script></head>`,
    );
  const file =
    route.path === "/"
      ? template
      : join(dist, route.path.replace(/^\//, ""), "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page);
  written.push({ ...route, file, page });
}

// The sitemap: every public address, each naming its twin in the other
// language, so a crawler that finds one finds both.
const alternateOf = (route) =>
  PUBLIC_ROUTES.filter((r) => r.page === route.page).map(
    (r) =>
      `    <xhtml:link rel="alternate" hreflang="${r.locale}" href="${SITE_URL}${r.path}"/>`,
  );
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...PUBLIC_ROUTES.map((route) =>
    [
      "  <url>",
      `    <loc>${SITE_URL}${route.path}</loc>`,
      ...alternateOf(route),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${PUBLIC_ROUTES.find((r) => r.page === route.page && r.locale === "ar").path}"/>`,
      "  </url>",
    ].join("\n"),
  ),
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(dist, "sitemap.xml"), sitemap);

// robots.txt and the header, from the same flag as the pages' robots meta.
// The product's own routes are listed as disallowed when the site is public:
// they are `noindex` anyway, but a crawler need not fetch them to learn it.
const robots = SITE_PUBLIC
  ? [
      "User-agent: *",
      "Allow: /",
      "Disallow: /dashboard",
      "Disallow: /account",
      "Disallow: /sync",
      "Disallow: /connected",
      "Disallow: /admin",
      "Disallow: /fixtures/",
      "",
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      "",
    ].join("\n")
  : "User-agent: *\nDisallow: /\n";
writeFileSync(join(dist, "robots.txt"), robots);

const htaccessPath = join(dist, ".htaccess");
if (SITE_PUBLIC && existsSync(htaccessPath)) {
  const htaccess = readFileSync(htaccessPath, "utf8");
  const stripped = htaccess.replace(
    /^\s*Header always set X-Robots-Tag[^\n]*\n/m,
    "",
  );
  if (stripped === htaccess)
    throw new Error("prerender: .htaccess carries no X-Robots-Tag to remove");
  writeFileSync(htaccessPath, stripped);
}

// The checks. Each is a thing that has gone wrong in a prerender somewhere:
// a page rendered in the wrong language, a fallback rendered in place of a
// lazy page, a head that never made it out of the fragment.
const failures = [];
const expectRobots = SITE_PUBLIC ? "index, follow" : "noindex, nofollow";
for (const { path, locale, page: kind, file } of written) {
  const at = (msg) => failures.push(`${path}: ${msg}`);
  const doc = readFileSync(file, "utf8");
  if (!doc.includes(`<html lang="${locale}"`)) at(`html lang is not ${locale}`);
  if (!/<h1[\s>]/.test(doc)) at("no <h1>");
  if (!doc.includes(`<link rel="canonical" href="${SITE_URL}${path}"`))
    at("canonical missing or wrong");
  if (!doc.includes(`<meta name="robots" content="${expectRobots}"`))
    at(`robots meta is not "${expectRobots}"`);
  for (const lang of ["ar", "en", "x-default"])
    if (!doc.includes(`hreflang="${lang}"`)) at(`no hreflang ${lang}`);
  const ld = doc.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!ld) at("no JSON-LD");
  else {
    try {
      const data = JSON.parse(ld[1]);
      if (data["@context"] !== "https://schema.org") at("JSON-LD context");
      if (kind === "home") {
        const faq = data["@graph"].find((n) => n["@type"] === "FAQPage");
        if (!faq || faq.mainEntity.length < 4) at("FAQPage missing or short");
      }
      if (kind === "pricing") {
        const app = data["@graph"].find(
          (n) => n["@type"] === "SoftwareApplication",
        );
        if (!app?.offers?.length) at("pricing page carries no offers");
      }
    } catch {
      at("JSON-LD does not parse");
    }
  }
  if (kind === "pricing") {
    if (!doc.includes(`id="${EMBEDDED_CATALOGUE_ID}"`))
      at("no embedded catalogue");
    if (!/pricing-card/.test(doc)) at("no pricing cards rendered");
  }
  if (doc.includes("<title></title>")) at("empty title");
}
const fallback = readFileSync(join(dist, "app.html"), "utf8");
if (!fallback.includes('<div id="root"></div>'))
  failures.push("app.html: root is not empty");

rmSync(ssrOut, { recursive: true, force: true });

if (failures.length) {
  console.error("prerender: FAILED\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  `prerender: ${written.length} pages, sitemap, robots.txt (${SITE_PUBLIC ? "public" : "noindex"})`,
);
for (const w of written)
  console.log(`  ${w.path.padEnd(20)} ${w.file.replace(dist, "dist")}`);
