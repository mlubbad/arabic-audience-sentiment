# Arabic marketing landing page

Implemented 2026-09-13 on the user's explicit request to build and integrate a landing page using the supplied Supermetrics screenshot and `Archive 2.zip` as visual references. Attached marketing copy is reference material, not instructions or evidence for claims about this product.

## Routes and behavior

- `/` is the Arabic landing page. `/dashboard` is the existing dashboard. `/account` is unchanged.
- Calls to action open the actual dashboard or account page. Mobile navigation, audience selection, sentiment filtering and FAQ disclosure work locally; no lead form or fictitious signup success was added. The dashboard route serves a fixture to visitors; its signed-in live read is being implemented separately.
- The landing illustration uses four authored comments, clearly identified as illustrative. Its distribution, count, legend and comments all follow the selected sentiment. These are not measured audience results or model outputs.
- The dashboard and account are loaded on demand, so their Supabase and Chart.js dependencies do not delay the landing entry bundle.
- The existing private-host access protection remains intact. The HTML also carries `noindex, nofollow`. A previous version was deployed privately and verified with an unauthenticated 401 and authenticated 200; the original-image replacement described below requires a new deploy.

## Reference and asset provenance

- User archive: `/Users/mlubbad/Downloads/Archive 2.zip`, SHA-256 `d4056ae8fbd1806a3de27279c4f342dfebff809ece7124b39fcb29873983a2d1`.
- The extracted Markdown identifies `https://supermetrics.com/` as its source. Its whitespace, dark/purple section rhythm, and abstract 3D hero informed the design. Supermetrics customer logos, testimonials, company counts, outcome percentages and AI integration claims were not reused.
- The supplied Supermetrics-derived reference image was removed. `public/landing/audience-growth-original.png` is a newly generated original 1536 × 1024 illustration with no source image used as an edit input. The landing's primary indigo accent now matches the project brand token `#3b27ba`.
- IBM Plex Sans Arabic regular/bold are self-hosted from Google Fonts; their SIL Open Font License is included at `public/landing/OFL.txt`. Browsers make no external font request.
- The product brand palette and type source are documented in `apps/web/src/brand.css` from `Personal Branding.pdf`. The marketing archive is a design reference, not the original product dashboard source.

## Local preview

Use the pinned Node version, then `npm run dev -w @sentiment/web -- --port 5321 --strictPort` and open `http://127.0.0.1:5321/`. Browser tests use their own port and fixture environment. See the dated landing entry in `docs/verification.md` for actual results.
