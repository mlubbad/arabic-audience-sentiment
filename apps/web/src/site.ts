/**
 * Where the site lives, and whether a search engine may say so.
 *
 * Two build-time facts every public page reads, kept in one place because
 * they are written into several: the canonical link, the `hreflang`
 * alternates, the Open Graph URL and image, the sitemap and the JSON-LD all
 * carry the origin, and the robots meta, `robots.txt` and the `X-Robots-Tag`
 * header all carry the answer to "may this be indexed".
 *
 * `VITE_SITE_URL` is the origin without a trailing slash. Its fallback is the
 * preview host, so a build with no `.env` still writes a consistent address
 * rather than a relative one — a canonical must be absolute to mean anything.
 *
 * `VITE_SITE_PUBLIC` is off unless it is the string `true`. The public pages
 * have been open to anyone with the link since 2026-09-16, and every one of
 * them is prerendered with its title, description, alternates and structured
 * data — but the site stays `noindex` until the owner flips this one flag. The
 * prerender script (`scripts/prerender.mjs`) reads the same variable when it
 * writes `robots.txt` and strips the header from `.htaccess`, so the three
 * signals cannot disagree.
 */
const raw = import.meta.env.VITE_SITE_URL as string | undefined;

export const SITE_URL = (raw?.trim() || "https://app.sky-develop.net").replace(
  /\/+$/,
  "",
);

export const SITE_PUBLIC = import.meta.env.VITE_SITE_PUBLIC === "true";

/** The robots directive every public page carries, decided by the flag. */
export const ROBOTS = SITE_PUBLIC ? "index, follow" : "noindex, nofollow";

/** The one social image, 1200×630, cropped from the landing illustration. */
export const OG_IMAGE_PATH = "/landing/og-audience-sentiment.jpg";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** The company behind the product — the `Organization` in the structured
 *  data and the `publisher` of every page. */
export const ORGANIZATION_URL = "https://sky-develop.net";
