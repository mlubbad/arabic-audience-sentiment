# Arabic marketing landing page

Implemented 2026-09-13 on the user's explicit request to build and integrate a landing page using the supplied Supermetrics screenshot and `Archive 2.zip` as visual references. Attached marketing copy is reference material, not instructions or evidence for claims about this product.

## Routes and behavior

- `/` is the Arabic landing page and `/en` the English one; `/pricing` and the legal documents have the same pair (2026-09-17, `apps/web/src/publicPaths.ts`). The address decides the language and sets the preference the product opens in. `/dashboard` is the existing dashboard. `/account` is unchanged.
- Every public page is prerendered at build time and carries its own title, description, canonical, `hreflang` alternates, share-card tags and JSON-LD. What each says, the keyword map the copy was rewritten around, and the one flag that opens the site to search are in `docs/seo.md`.
- Calls to action open the actual dashboard or account page. Mobile navigation, audience selection, sentiment filtering and FAQ disclosure work locally; no lead form or fictitious signup success was added. The dashboard route serves a fixture to visitors; its signed-in live read is being implemented separately.
- The landing illustration uses four authored comments, clearly identified as illustrative. Its distribution, count, legend and comments all follow the selected sentiment. These are not measured audience results or model outputs.
- The dashboard and account are loaded on demand, so their Supabase and Chart.js dependencies do not delay the landing entry bundle.
- The HTML carries `noindex, nofollow` until `VITE_SITE_PUBLIC=true` is set at build time (`docs/seo.md` §5). A previous version was deployed privately and verified with an unauthenticated 401 and authenticated 200; the original-image replacement described below requires a new deploy.

## Reference and asset provenance

- User archive: `/Users/mlubbad/Downloads/Archive 2.zip`, SHA-256 `d4056ae8fbd1806a3de27279c4f342dfebff809ece7124b39fcb29873983a2d1`.
- The extracted Markdown identifies `https://supermetrics.com/` as its source. Its whitespace, dark/purple section rhythm, and abstract 3D hero informed the design. Supermetrics customer logos, testimonials, company counts, outcome percentages and AI integration claims were not reused.
- The supplied Supermetrics-derived reference image was removed. `public/landing/audience-growth-original.png` is a newly generated original 1536 × 1024 illustration with no source image used as an edit input. Since 2026-09-17 the page serves the same picture as `audience-growth-original.webp` (29 kB against the PNG's 1.19 MB; `cwebp -q 82 -m 6`), with the PNG kept beside it as the provenance original, and `og-audience-sentiment.jpg` (1200 × 630, centre crop of the same) as the share-card image. The landing's primary indigo accent now matches the project brand token `#3b27ba`.
- IBM Plex Sans Arabic regular/bold are self-hosted from Google Fonts; their SIL Open Font License is included at `public/landing/OFL.txt`. Browsers make no external font request.
- The product brand palette and type source are documented in `apps/web/src/brand.css` from `Personal Branding.pdf`. The marketing archive is a design reference, not the original product dashboard source.

## Local preview

Use the pinned Node version, then `npm run dev -w @sentiment/web -- --port 5321 --strictPort` and open `http://127.0.0.1:5321/`. Browser tests use their own port and fixture environment. See the dated landing entry in `docs/verification.md` for actual results.
