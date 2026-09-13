# Arabic marketing landing page

Implemented 2026-09-13 on the user's explicit request to build and integrate a landing page using the supplied Supermetrics screenshot and `Archive 2.zip` as visual references. Attached marketing copy is reference material, not instructions or evidence for claims about this product.

## Routes and behavior

- `/` is the Arabic landing page. `/dashboard` is the existing dashboard. `/account` is unchanged.
- Calls to action open the actual dashboard or account page. Mobile navigation, audience selection, sentiment filtering and FAQ disclosure work locally; no lead form or fictitious signup success was added.
- The landing illustration uses four authored comments, clearly identified as illustrative. Its distribution, count, legend and comments all follow the selected sentiment. These are not measured audience results or model outputs.
- The dashboard and account are loaded on demand, so their Supabase and Chart.js dependencies do not delay the landing entry bundle.
- The existing private-host access protection remains intact. The HTML also carries `noindex, nofollow`. This implementation was verified locally; no remote deploy was run for this change.

## Reference and asset provenance

- User archive: `/Users/mlubbad/Downloads/Archive 2.zip`, SHA-256 `d4056ae8fbd1806a3de27279c4f342dfebff809ece7124b39fcb29873983a2d1`.
- The extracted Markdown identifies `https://supermetrics.com/` as its source. Its whitespace, dark/purple section rhythm, and abstract 3D hero informed the design. Supermetrics customer logos, testimonials, company counts, outcome percentages and AI integration claims were not reused.
- `public/landing/audience-growth.png` is the unmodified abstract image supplied as `1ede55071c753090af300dbb270ed64652e5cab5-2089x1800.png`. Actual dimensions are 1920 × 1331; SHA-256 `6a3b92fcd69e650be935ac67078499e711dd577c5315313a1de75222a5570dba`. It is a supplied reference asset for the private preview, not a newly commissioned brand asset. Public reuse rights have not been established.
- IBM Plex Sans Arabic regular/bold are self-hosted from Google Fonts; their SIL Open Font License is included at `public/landing/OFL.txt`. Browsers make no external font request.
- Original product dashboard HTML/ZIP and final brand assets remain separate missing inputs. This marketing-reference archive does not resolve those items.

## Local preview

Use the pinned Node version, then `npm run dev -w @sentiment/web -- --port 5321 --strictPort` and open `http://127.0.0.1:5321/`. Browser tests use their own port and fixture environment. See the dated landing entry in `docs/verification.md` for actual results.
