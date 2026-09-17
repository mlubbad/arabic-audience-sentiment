# The demo data reads like a real channel (design)

2026-09-17. Requested by the operator after the dashboard rebuild: no more «بيانات اصطناعية»,
«مؤلف اصطناعي 1», «فيديو اصطناعي ١». The visitor's dashboard, the landing demo and the
catalogue fixture should look the way a product's seeded demo account looks — real-looking
channel, videos and commenters, comments in several *spoken* Arabic dialects (Gulf and
Maghrebi especially), all linguistically sound — while staying honestly marked as an example.

## What exists

- `apps/web/public/fixtures/dashboard.json` — 7 comments on 2 videos, authored as a **test
  kernel**: one unanalysed row, one whose text changed after analysis (stale hash), one with an
  unknown date and unknown likes, one reply, one channel-owner reply, two comment types. 76+
  Playwright tests in `tests/e2e/dashboard.spec.ts` assert its exact arithmetic (6 comments,
  4 analysed, 48 likes, «المقدمة طويلة»…).
- `apps/web/public/fixtures/catalogue.json` — the `/sync` catalogue fixture (`فيديو اصطناعي ١/٢`,
  `بث اصطناعي ٣`).
- `apps/web/src/landing/demoData.ts` — the landing's four comments («شرح واضح…», «المحتوى جميل،
  لكن المقدمة طويلة قليلًا», …), read by `tests/e2e/landing.spec.ts`.
- Strings that say «اصطناعي»: `dsFixtureBadge` («بيانات اصطناعية»), `fixtureVideo(n)`,
  `footerNote`, `opsDemoNote`, the fixture-mode review note, two FAQ answers, an account lead.
  `docs/legal/*` says «بيانات اصطناعية موضّحة بوضوح» — legal text, left as is.

## Approach: two fixtures, one generator

**Two fixtures.** The test kernel's arithmetic is load-bearing for 76 tests and is *good*
test design (every honesty state of the product in seven rows). It stays — re-skinned — as
the **e2e fixture**, and a new **demo fixture** replaces what visitors see:

- `apps/web/public/fixtures/e2e-dashboard.json` — the current file with only the human-visible
  strings changed: channel, video titles, commenter names, comment texts — same ids, counts,
  likes, dates, flags, reply/owner structure, comment types, topics; `content_hash`
  recomputed as sha256 of the new `text_raw` except the deliberately stale row, whose
  prediction hash stays the *old* text's hash so it remains "changed after analysis".
- `apps/web/public/fixtures/dashboard.json` — the **demo**: one channel «عالم التقنية مع سالم»,
  6 videos (4 videos, 1 short, 1 stream), 44 comments across Gulf, Maghrebi, Egyptian,
  Levantine, Iraqi and Sudanese speech, ~12 replies, one channel-owner reply, 2 unanalysed
  rows, 1 stale-hash row, 2 rows with unknown date/likes, comment types on ~10 rows, topic
  predictions on every analysed row, a handful of human reviews. Same schema, same
  `revision`/`analysis_key` conventions.
- `apps/web/public/fixtures/catalogue.json` — titles from the same channel; ids unchanged.
- `data.ts` reads the path from `import.meta.env.VITE_FIXTURE_DASHBOARD ?? "/fixtures/dashboard.json"`;
  `playwright.config.ts` sets `VITE_FIXTURE_DASHBOARD=/fixtures/e2e-dashboard.json` on both
  web servers. Unit tests that read the fixture file run their invariants over **both** files.

**One generator.** `apps/web/scripts/make-demo-fixture.mjs` builds both JSON files from an
authored content module `apps/web/scripts/demo-content.mjs` (the channel, videos, commenters
and comments as plain data with dialect tags) so hashes, ids and timestamps are consistent
and a future edit is a content edit, not JSON surgery. `npm run demo:fixture` runs it; a unit
test asserts the committed JSON equals the generator's output (so nobody edits JSON by hand).

**Words.** «اصطناعي» leaves the product's vocabulary for the demo: the provenance badge
becomes «بيانات توضيحية», the fixture-video fallback goes (every video now has a title; the
`videoLabel` fallback returns the id as it does for live rows), and the six prose strings say
«بيانات توضيحية مؤلَّفة» / "illustrative, authored data" — still honest, no longer a
placeholder's name. The `field_provenance.origin` in both fixtures reads
`"authored illustrative demo data; not real commenters"`.

**Landing demo.** `demoData.ts`'s four comments are rewritten in four dialects (one per
sentiment) and stay four (the landing e2e and `ProductWindow` tests count them); the landing
e2e's quoted phrases update.

## Content rules

- Every comment is something a person would write under that video: dialect-consistent,
  spelled the way the dialect is written online, no mixing dialects in one comment, no
  transliterated English beyond what is common (آيفون، لابتوب، أبديت).
- Names: realistic Arabic first/last names and handles across the region (نورة القحطاني،
  @abu_faisal، يوسف بن عمر، مريم الشرقاوي، حسام الدين، @khadija.tn، …); no real public figures.
- No hate, politics, religion beyond a passing «ما شاء الله»/«الله يعطيك العافية» (which
  the `religious` topic exists for), no product claims presented as facts.
- Sentiment and topic labels must be what a careful annotator would assign; mixed is «حلو
  بس…», not lukewarm; neutral is a question or information.
- Likes and dates plausible (recent weeks, bursts after publication, a few late ones).

## Testing

- `make-demo-fixture.test.ts`: generator output equals the committed files; every
  `content_hash` is sha256 of `text_raw` except the flagged stale rows; every `video_id`
  exists in the catalogue; every topic key exists; counts as the spec states.
- Existing unit tests reading the fixture run over both files.
- e2e: `dashboard.spec.ts` unchanged in arithmetic (it runs on the e2e fixture) with only the
  quoted human strings updated; `landing.spec.ts` phrases updated; one new demo smoke e2e in a
  `demo` project or simply a unit render? — a Playwright test that loads `/dashboard` with the
  demo fixture (default env) and asserts: 44 comments read, 6 videos, no overflow at 390.
- `npm run check` green.

## Out of scope

Live data; the worker's real analysis; legal text; the `/sync` operations fixture beyond
titles; translating comments to English (they are the data, shown as written).
