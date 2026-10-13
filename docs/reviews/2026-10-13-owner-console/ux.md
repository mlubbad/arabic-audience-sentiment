# UX walkthrough notes (2026-10-13)

Harness: real web app (vite dev, port 5199) against a mocked Supabase whose RPC
answers were produced by the real admin functions on a local Postgres 16 with
every migration applied and synthetic data (13 channels in 27 workspaces, one
with 155,822 comments). Screens: shots/{desktop,phone}-NN-*.png (1440 and 390 px).

## Cross-cutting
- The right rail inside /admin is the customer rail: "مساحة العمل الشخصية",
  "لا خطة مفعّلة", the tour button. Irrelevant to the owner and confusing
  (whose workspace? whose plan?). The rail also stops short of the page
  height (ends ~930 px on long pages).
- Raw codes shown to the owner: plan keys ("free", "t", "pro"), subscription
  status "active" (Workspaces, Accounts); audit actions untranslated (Audit
  page; five action names missing from adminAccountActions).
- A free plan's period end shows as 2126-10-13 (Accounts list, 100 years).
- Channels with no title show the raw external id ("UCchannel…") and a
  workspace named "w" — no fallback label.

## Home (/admin)
- The morning summary takes the whole first screen; the tiles and the
  "needs attention" list sit below it. Priority is inverted.
- Label/value pairs span the full card width in RTL (label right, number far
  left, ~1,000 px apart) — hard to read across.
- Movers list: channel name and its delta are on different lines/sides.

## Workspaces (/admin/workspaces)
- Every row carries the full edit form inline (plan select, override, note,
  pack type/units/note, three buttons). 27 workspaces = a 7,471 px page.
- "حذف نهائي" (permanent delete) is a red button on every row, next to routine
  actions.
- No search, filter or owner column; many rows are named
  "مساحة العمل الشخصية" and cannot be told apart.

## Accounts (/admin/users) and the account file
- The list is readable; the file opens as a side panel (good).
- Plan column shows raw keys and the 2126 end date (above).

## Channels (/admin/channels)
- Desktop: clear state chips with counts, filters, bulk select. Good.
- Phone (390 px): the table shows only the channel column; state, counts and
  last success are cut off; emails are clipped mid-word. Unusable on a phone.

## Comparison (/admin/compare)
- With data (local) the page reads well: three highlight cards, ranking,
  search, CSV.
- In production it is empty because the recount never completed (Phase 0);
  the page gives no sign that the background job is failing — it says
  "pending" forever.

## System (/admin/system)
- Five cards. There is no card for background jobs (cron runs, compare
  recount, digest); the compare failure was invisible here.

## Import (/admin/import)
- Phone: horizontal overflow of 23 px.
