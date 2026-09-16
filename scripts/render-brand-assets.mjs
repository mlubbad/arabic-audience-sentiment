// Renders every file that carries the brand mark, from the one geometry table
// the app itself draws it with (apps/web/src/brandMark.geometry.mjs), with the
// colours read out of brand.css rather than typed here. Run from the repo root:
//
//   node scripts/render-brand-assets.mjs
//
// Writes:
//   apps/web/public/favicon.svg            transparent, the mark alone
//   apps/web/public/icon-192.png           on brand indigo, for the manifest
//   apps/web/public/icon-512.png           on brand indigo, for the manifest
//   apps/web/public/apple-touch-icon.png   on brand indigo, 180 — iOS flattens
//                                          transparency to black otherwise
//   apps/web/public/site.webmanifest
//   docs/oauth-verification-assets/audience-sentiment-logo.png
//                                          512, transparent — the Google OAuth
//                                          branding logo, now the same shapes
//
// The PNGs are rasterised by headless Chromium (Playwright is already a dev
// dependency for the browser suite), so what lands in the file is the same
// SVG the browser will draw in the tab.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { brandMarkSvg } from "../apps/web/src/brandMark.geometry.mjs";

const brand = readFileSync("apps/web/src/brand.css", "utf8");
const token = (name) => {
  const m = brand.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`brand.css has no ${name}`);
  return m[1];
};
const indigo = token("--ml-indigo");
const rose = token("--ml-rose");
// The tile behind the manifest/touch icons: the darkest brand indigo, so the
// mark's own indigo still reads against it (the same plane the rail uses).
const tile = token("--ml-indigo-900");

const markOnly = brandMarkSvg({ indigo, rose });
// On a tile the three bars lift to the lighter indigo — the rail's treatment
// — so they are not indigo-on-indigo.
const onTile = brandMarkSvg({
  indigo: token("--ml-indigo-300"),
  rose,
  background: tile,
});

mkdirSync("apps/web/public", { recursive: true });
writeFileSync("apps/web/public/favicon.svg", markOnly);
writeFileSync(
  "apps/web/public/site.webmanifest",
  JSON.stringify(
    {
      name: "مشاعر الجمهور",
      short_name: "مشاعر الجمهور",
      lang: "ar",
      dir: "rtl",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      theme_color: indigo,
      background_color: tile,
      display: "standalone",
      start_url: "/",
    },
    null,
    2,
  ) + "\n",
);

const browser = await chromium.launch();
async function png(svg, size, path) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style></head><body>${svg}</body></html>`,
  );
  await page.screenshot({ path, omitBackground: true });
  await page.close();
  console.log(`wrote ${path}`);
}
await png(onTile, 192, "apps/web/public/icon-192.png");
await png(onTile, 512, "apps/web/public/icon-512.png");
await png(onTile, 180, "apps/web/public/apple-touch-icon.png");
await png(
  markOnly,
  512,
  "docs/oauth-verification-assets/audience-sentiment-logo.png",
);
await browser.close();
console.log(
  "wrote apps/web/public/favicon.svg, apps/web/public/site.webmanifest",
);
