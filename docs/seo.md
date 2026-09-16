# On-page SEO for the public face

The four pages a reader meets signed out — the landing (`/`), the pricing page
(`/pricing`) and the two legal documents (`/privacy-policy`, `/terms`) — and what
each tells a search engine and a share card. Implemented 2026-09-17 on the owner's
explicit request for a full on-page review with content rewritten to be found as
well as read, on top of the `/en` addresses and the prerender it needed.

Status in one line: **built, verified, and open to search since 2026-09-17** — the owner
set `VITE_SITE_PUBLIC=true` and deployed; see "Going live" at the end for what was
checked and the one thing (a cached `robots.txt` at the edge) that was still catching up.

---

## 1. What stood in the way, and what changed

| Before (2026-09-16) | After |
| --- | --- |
| Client-rendered only: a crawler that does not run JavaScript, and every share card, saw an empty `<div id="root">` | `scripts/prerender.mjs` renders every public address to static HTML at build time; the browser hydrates it (`main.tsx`) |
| One document at `/` that rendered in whichever language `localStorage` held; no English page to link, cite or mark as an alternate | Every public page has an Arabic address and an English one under `/en` (`publicPaths.ts`); the address decides the language, and reading a page sets the preference the product opens in |
| Title and description written once in `index.html`, for every route; no canonical, no `hreflang`, no Open Graph, no Twitter card, no structured data, no sitemap | Each page renders its own head (`PageHead.tsx`, from `seo.ts`): title, description, robots, canonical, three `hreflang` alternates, Open Graph and Twitter tags, and JSON-LD |
| `/pricing` titled "الأسعار" with no description and nothing machine-readable, despite being the page with buying intent | H1 and title say what is priced; `Offer` structured data per self-serve plan, read from the same catalogue rows the cards read — the live rows at build time, embedded in the page so hydration starts from them |
| Hero image a 1.19 MB PNG with `alt=""`, fetched at high priority | Same picture as a 29 kB WebP with a descriptive alt; a 1200×630 JPEG share image cropped from it |
| Copy that was good to read and said none of the phrases people search: no keyword in the H1, the H2s or the description | Copy rewritten in both languages around a small keyword map (§2), one phrase per place, in sentences; eight FAQ entries where there were four, each also a `FAQPage` question |
| `noindex` in three places (meta, header, `robots.txt`), each edited by hand | One flag, `VITE_SITE_PUBLIC`, flips all three at build time (§5) |

Two things did not change and are not meant to: the product's own routes
(`/dashboard`, `/account`, `/sync`, `/connected`, `/admin`) stay client-rendered
and `noindex`, and no page states a price outside the catalogue (`seo.test.ts` sweeps
the landing's copy for one).

---

## 2. Keyword map

Search intent for this product is transactional-commercial: someone looking for a
tool, not an article. The phrases below are the ones a reader would type; each sits
once in the places a result is built from and is otherwise used only where a
sentence calls for it. No phrase is repeated to be repeated — Google's own guidance
is that stuffing costs more than it earns, and the copy has to be read by the same
person afterwards.

| Role | Arabic | English |
| --- | --- | --- |
| Primary | تحليل تعليقات يوتيوب | YouTube comment analysis |
| Secondary | تحليل مشاعر الجمهور · تحليل المشاعر بالعربية | Arabic sentiment analysis · audience sentiment |
| Supporting | أداة تحليل التعليقات العربية · مشاعر الجمهور على يوتيوب · اللهجات العربية · صنّاع المحتوى والمؤثرين · الوكالات وفرق الميديا | Arabic YouTube comments · Arabic dialects · creators and influencers · agencies and media teams |
| Long tail (FAQ) | ما هو تحليل مشاعر تعليقات يوتيوب · هل تعمل مع اللهجات · الفرق بين المختلط والمحايد · كم تكلفة تحليل التعليقات | what is comment sentiment analysis · does it work with dialects · mixed vs neutral · how much does it cost |

Where each lands, on the landing:

| Place | Arabic | English |
| --- | --- | --- |
| `<title>` (≤ 60 chars, tested) | تحليل تعليقات يوتيوب بالعربية — مشاعر الجمهور | Arabic YouTube Comment Analysis — Audience Sentiment |
| Meta description (70–160, tested) | حلّل تعليقات يوتيوب بالعربية وافهم مشاعر جمهورك: إيجابي وسلبي ومحايد ومختلط، مقارنة بين الفيديوهات، مراجعة بشرية وتصدير. جرّب اللوحة التجريبية مجانًا. | Analyse Arabic YouTube comments and see how your audience really feels — positive, negative, neutral or mixed. Compare videos, review labels, export. Free demo. |
| H1 | افهم مشاعر جمهورك / من تعليقات يوتيوب، / بالعربية. | Understand your audience / through YouTube comments, / in Arabic. |
| Eyebrow above H1 | أداة تحليل تعليقات يوتيوب للجمهور العربي | YouTube comment analysis for Arabic audiences |
| H2 "why" | المشاهدات تقول كم شخصًا وصل إليه محتواك. / التعليقات تقول ماذا شعروا به. | Views say how many people your content reached. / Comments say how they felt about it. |
| H2 "demo" | لوحة تحليل المشاعر: من صورة الجمهور الكاملة إلى التعليق الواحد. | The sentiment dashboard: from the whole audience to a single comment. |
| H3 benefits | أربع فئات للمشاعر، لا لونان · قارن فيديوهاتك ضمن الفلاتر نفسها · مراجعة بشرية تصحّح قراءة الآلة | Four sentiment classes, not two colours · Compare your videos under the same filters · Human review corrects the machine's reading |
| H2 "audience" | لصنّاع المحتوى والمؤثرين، وللوكالات وفرق الميديا. | For creators and influencers, and for agencies and media teams. |
| H2 FAQ | أسئلة شائعة عن تحليل تعليقات يوتيوب | Frequently asked questions about YouTube comment analysis |
| Hero image alt | رسم توضيحي: تعليقات يوتيوب تتحوّل إلى مخطط لمشاعر الجمهور بالعربية | Illustration: YouTube comments turning into a chart of audience sentiment in Arabic |

The pricing page: H1/title «أسعار تحليل تعليقات يوتيوب» / "YouTube comment analysis
pricing"; the nav link keeps the one word «الأسعار» / "Pricing". The legal pages take
their document's title and the first 160 characters of its lead.

**What the copy still refuses to say.** No accuracy figure (the FAQ says none has
been adopted), no customer or channel count, no price outside the catalogue. The
answers about the beta ("can I connect my channel now?") are the same honest ones as
before; two were merged and five were added. `seo.test.ts` holds the lines to this.

---

## 3. What each page carries

Rendered by `PageHead.tsx` from a `PageSeo` built in `seo.ts`; the same head is
written into the prerendered file and adopted by React on hydration, so the browser
holds exactly one of each (checked in `tests/e2e/seo.spec.ts`).

- `<title>`, `<meta name="description">`, `<meta name="robots">` (from the flag)
- `<link rel="canonical">` — absolute, no trailing slash, `VITE_SITE_URL` origin
- `<link rel="alternate" hreflang>` × 3: `ar`, `en`, and `x-default` → Arabic
- Open Graph: `type`, `site_name`, `locale`, `locale:alternate`, `title`,
  `description`, `url`, `image` (+ width, height, alt)
- Twitter: `summary_large_image`, title, description, image (+ alt)
- JSON-LD `@graph`: `Organization` (Sky Develop), `WebSite`, `WebPage`, and
  - landing: `SoftwareApplication` (category, features) + `FAQPage` with every
    question on the page, in order
  - pricing: `SoftwareApplication` with one `Offer` per self-serve plan — monthly USD
    price, `valueAddedTaxIncluded: false`, `unitCode: MON` — from the catalogue
  - legal: `WebPage.dateModified` from the document's date

`dist/sitemap.xml` lists the eight addresses with their `xhtml:link` alternates.

---

## 4. How the prerender works

`npm run build` in `apps/web` is now `vite build && node scripts/prerender.mjs`. The
script builds a Vite SSR bundle of `src/entry-prerender.tsx`, which mounts the same
route table as the browser (`publicRoutes.tsx`, over `PUBLIC_ROUTES`) under a
`StaticRouter`, renders each address with `renderToString`, and writes:

| File | What |
| --- | --- |
| `dist/index.html` | `/`, prerendered |
| `dist/<path>/index.html` | the other seven addresses |
| `dist/app.html` | the untouched template plus a `noindex` meta — the SPA fallback for every non-public route |
| `dist/sitemap.xml`, `dist/robots.txt` | from the flag |
| `dist/.htaccess` | the `X-Robots-Tag` line removed when public |

`public/.htaccess` serves `<path>/index.html` for `/<path>` as an internal rewrite
(so `/pricing` is not redirected to `/pricing/` by `mod_dir`) and `app.html` for
anything that is not a file, a directory or a prerendered page. `index.html` no
longer carries a title, description or robots of its own — a static copy would be a
second title on every page and a `noindex` that outranks the page's `index`.

Three things had to match between the two renders for React to hydrate rather than
discard the markup and render twice, each found by a real mismatch on the first
try: the language (the entry loads the strings and sets the locale store before
rendering, as `main.tsx` does before hydrating); the `Suspense` boundary the browser
wraps a lazy page in (the entry wraps the eager page in the same one, so the markers
are in the HTML); and the `ToastHost` sibling beside the router. The legal pages'
formatted date carries `suppressHydrationWarning` because ICU on the server and in
the browser may differ by a joiner. Verified with the development React bundle, which
names a mismatch: none on any of the eight pages, nor on `/dashboard` and `/account`
through `app.html`.

The pricing page is rendered with the catalogue read at build time (`plan_catalogue()`
from the configured project, the fixture when it does not answer — the script says
which) and the rows are embedded as `<script type="application/json"
id="plan-catalogue">`; `usePlanCatalogue` takes them as stale initial data, so the
hydrated page shows the cards the static HTML showed and then refetches.

Every output is checked before the script exits 0: `<html lang>`, an `<h1>`, the
canonical, the robots meta, three `hreflang`s, JSON-LD that parses (with the FAQ on
the landing and offers on the pricing page), the embedded catalogue and rendered
cards on the pricing page, and an empty root in `app.html`.

---

## 5. Going live: the one flag, and the checklist around it

`VITE_SITE_PUBLIC=true` at build time turns, together:

- every public page's `<meta name="robots">` to `index, follow`
- `dist/robots.txt` to `Allow: /` with the product's routes disallowed and a
  `Sitemap:` line
- `dist/.htaccess` to carry no `X-Robots-Tag`

Anything else leaves all three at `noindex`. `app.html` (the shell) carries `noindex`
either way, and `AppLayout` renders the same meta for a crawler that runs React.

Before flipping it:

1. **Decide the origin.** `VITE_SITE_URL` defaults to `https://app.sky-develop.net`; if
   the public face moves to another host, set it, because the canonical, the
   alternates, the share URL and the sitemap all carry it.
2. **Check what Cloudflare serves at `/robots.txt`.** Two things have gone wrong here.
   `docs/deployment.md` recorded Cloudflare Managed Content replacing ours with its own
   (1836 bytes, AI crawlers only); on 2026-09-17 ours was served instead. Then, on the
   deploy that opened it, the edge kept serving the closed 26-byte copy from cache
   (`cf-cache-status: HIT`, `cache-control: max-age=14400` — a zone rule overriding the
   origin's `no-cache`, which `.htaccess` now sends for `.txt` and `.xml`). This repo has
   no purge credential: purge `https://app.sky-develop.net/robots.txt` in the Cloudflare
   dashboard, or wait out the TTL, and fetch it again from outside before submitting the
   sitemap. The meta and the header are per-page and were correct at once.
3. Build with the flag, deploy, and fetch `/`, `/en`, `/pricing` and `/robots.txt` from
   outside: `curl -sI` for the absence of `X-Robots-Tag`, `curl -s | grep robots` for
   the meta.
4. Submit `https://<origin>/sitemap.xml` in Search Console; validate the JSON-LD with
   the Rich Results test (the FAQ and the offers are the two that can show).
5. Share one URL in a chat app to see the card; the image is
   `/landing/og-audience-sentiment.jpg`.

---

## 6. Not done here, and why

- **Off-page**: backlinks, listings, Search Console data — nothing to measure until
  the site is indexed.
- **A blog or guides** for the informational long tail («كيف أحلل تعليقات يوتيوب»):
  worth doing once the product is public; the FAQ carries the first answers.
- **Core Web Vitals on the live host**: the hero is 29 kB and preloaded, the fonts are
  self-hosted, but LCP/CLS on the CDN were not measured from here.
- **`/en` for the product itself**: the shell's language stays a preference; its
  routes are not indexed, so they need no second address.

---

## 7. Files

`apps/web/src/site.ts` (origin, flag), `publicPaths.ts` (addresses),
`publicRoutes.tsx` (route table), `seo.ts` (page metadata and JSON-LD),
`PageHead.tsx` (head elements, `usePublicLocale`), `entry-prerender.tsx`,
`apps/web/scripts/prerender.mjs`, `public/.htaccess`, `index.html`; the copy in
`strings/ar.ts` and `strings/en.ts` under "the landing page"; tests in `seo.test.ts`,
`publicPaths.test.ts`, `prerender.test.ts`, `tests/e2e/seo.spec.ts`.
