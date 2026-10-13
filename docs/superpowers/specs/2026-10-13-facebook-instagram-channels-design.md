# Facebook and Instagram channels: two doors, one worker — design

Date: 2026-10-13. Author: Claude (PM/architect). Status: approved by the owner's
request of 2026-10-13 ("research, plan, then execute the whole plan"); the
calls marked *(my call)* were made by Claude and are the owner's to overturn.

## 1. Intent and why

A workspace can already follow YouTube (owner OAuth or public id), X, TikTok and
Telegram. The owner wants the same for **Facebook Pages** and **Instagram
accounts**: paste a profile link, get the posts, their comments and their
counts, run the usual sentiment and topic classification. Two doors, as on
YouTube:

1. **Owner consent (OAuth).** The page's or account's owner signs in with Meta
   and the platform reads through Meta's Graph API. Free, rate-limited
   generously, stable, and the only path Meta sanctions.
2. **Public collection without the owner.** The preferred door for this
   product's buyers (agencies and researchers who do not own the channels).
   Meta blocks unauthenticated reads of comments, so this door is a managed
   scraper, not a home-grown one.

X and TikTok already have both doors in the worker (`x_collector.py`,
`tiktok_collector.py`); this design brings Facebook and Instagram to the same
shape and, while there, opens the dashboard's platform filter for all six
platforms (today X/TikTok/Facebook/Instagram are greyed "soon").

## 2. What the research found (2026-10-13)

### 2.1 Owner door: Meta's APIs are free

| Platform | Login flow | Scopes | Read endpoints | Token life |
| --- | --- | --- | --- | --- |
| Facebook Page | Facebook Login, `https://www.facebook.com/v25.0/dialog/oauth` → `GET https://graph.facebook.com/v25.0/oauth/access_token` → long-lived user token (`fb_exchange_token`) → `GET /me/accounts` gives a **page access token** | `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` | `/{page-id}/posts`, `/{post-id}/comments?filter=stream` | Page tokens minted from a long-lived user token do not expire |
| Instagram professional account | Instagram API with Instagram Login, `https://www.instagram.com/oauth/authorize` → `POST https://api.instagram.com/oauth/access_token` → `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token` | `instagram_business_basic`, `instagram_business_manage_comments` | `/me/media`, `/{media-id}/comments` | 60 days; `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` extends it (token must be ≥24 h old) |

Neither flow documents PKCE; CSRF protection is the `state` parameter, which
this project already hashes and binds to the browser nonce. Meta requires App
Review (Advanced Access) before accounts the app's admins do not own can grant
these scopes; until then the door works for the owner's own test pages. The
older `business_*` Instagram scope names were deprecated 2025-01-27.

Sources: Meta's Instagram-API-with-Instagram-Login business-login page and
comment-moderation guide; Facebook Login "manually build a login flow";
Pages API permission reference (all read 2026-10-13).

### 2.2 Public door: managed scrapers are the only stable option

Free libraries (instaloader, facebook-scraper) are throttled to one or two
anonymous requests per half minute, blocked from datacenter IPs by TLS
fingerprinting, and need a logged-in session for comments; a session account
is banned within days. That is not "stable and reliable". The project already
pays per result on Apify and Bright Data for X and TikTok, so Facebook and
Instagram join the same chain:

| Need | Apify (official actors, free tier price) | Bright Data dataset |
| --- | --- | --- |
| Instagram posts of a profile | `apify/instagram-post-scraper` — $1.7 / 1,000 posts (basic data) | `gd_lk5ns7kz21pck8jpis` (posts), `gd_lyclm20il4r5helnj` (reels) |
| Instagram comments of a post | `apify/instagram-comment-scraper` — $2.6 / 1,000 (free tier: top 15 per post) | `gd_ltppn085pokosxh13` |
| Facebook posts of a page | `apify/facebook-posts-scraper` — $5 / 1,000 + $0.001 per run | `gd_lkaxegm826bjpoo9m5` |
| Facebook comments of a post | `apify/facebook-comments-scraper` — $2.5 / 1,000 + $0.001 per run | `gd_lkay758p1eanlolqw8` |

Apify's free plan carries $5 of monthly credit, so a pilot of a few channels
costs nothing; a 20-post, 2,000-comment Facebook page costs about $5.20 per
full read, an Instagram one about $5.25. Cheaper community actors exist
($0.5 / 1,000) but have one-digit review counts; the actor name is an
environment variable, so the operator can switch without a deploy.

Public **naming** (turning a pasted link into a title and face for the
candidate list) is free: Instagram's `web_profile_info` endpoint and a
Facebook page's Open Graph tags answer without login at the one-request
volume the lookup makes; when they refuse, the candidate falls back to the
bare handle, exactly as X and TikTok do today.

## 3. Goals, non-goals, anti-goals

**Goals**
- Add a public Facebook page or Instagram account by link or handle; catalogue
  its posts; collect comments and replies; classify; show on the dashboard
  under its own platform filter and with working "open on …" links.
- Connect a Facebook page or Instagram professional account by owner consent
  through the existing OAuth state/ticket/nonce machinery, with the same
  sealing of tokens and the same "reconnect required" path on revocation.
- Both doors are idempotent, report `partial/failed/blocked` on any short
  read, and never invent counts or dates.
- Operator can choose the scraper per platform (`apify`, `brightdata`) and the
  actor/dataset ids, from environment only.

**Non-goals (this change)**
- Facebook Groups, personal profiles, Stories, Reels-only feeds, ads, DMs.
- Choosing among several pages one Facebook user administers (exactly one page
  is connected; more is `ambiguous_channel`, as YouTube handles several
  channels today). *(my call; follow-up: a page chooser.)*
- Meta App Review itself (owner's task; the code is review-ready: least
  scopes, privacy-policy link already live).
- Extending the admin "services health" RPC from four platforms to six (a
  separate migration; its UI types are four-wide).
- Upgrading a public row to a connected one when the same page arrives
  through both doors: public rows key on the vanity handle, connected rows on
  Meta's numeric id, so they are two rows. *(my call; documented limitation.)*

**Anti-goals**
- A home-grown headless-browser scraper of Meta properties. It would not be
  stable, and a banned IP would take the X/TikTok public fallbacks with it.
- Any path that reports an empty dataset as success when Meta refused.

## 4. Constraints (binding)

- `AGENTS.md` and `docs/agents/CONTEXT.md` §5 invariants; the five CI gates.
- Secrets only in Supabase function secrets and the worker's environment.
- Migrations are new files; `20261024000000_meta_oauth_providers.sql`.
- New strings in both `strings/ar.ts` and `strings/en.ts`.
- `WorkspaceCard.tsx` (1,052 lines) may only shrink; new files ≤ 400 lines.

## 5. The design

### 5.1 Data model (one migration)

- `private.oauth_states.provider text not null default 'google'`
  `check (provider in ('google','facebook','instagram'))`.
- `private.oauth_pending.platform text not null default 'youtube'`
  `check (platform in ('youtube','facebook','instagram'))`.
- `oauth_start_impl` / `public.oauth_start` gain `p_provider text default
  'google'` (dropped and recreated with the default, so PostgREST has one
  candidate and the five-argument callers keep working).
- `svc_oauth_consume_state` returns `provider`.
- `oauth_create_pending` / `svc_oauth_create_pending` gain `pending_platform`;
  the id check is per platform: YouTube `^UC[A-Za-z0-9_-]{22}$`, Meta
  `^[0-9]{1,64}$`.
- `oauth_attach_channel_for` gains `p_platform`; the channel upsert and the
  "already connected elsewhere" check key on `(platform, external_channel_id)`.
- `oauth_complete_impl` passes `pending.platform` through.
- Grants/revokes mirror the existing ones exactly.

No change to `videos.kind`: Facebook and Instagram content maps onto the
existing kinds — text/photo/carousel post → `channel_post`, video → `video`,
reel → `short`. *(my call: the dashboard's kind filter already names these;
a `reel` kind would touch five redefinitions of `commit_catalogue`.)*

### 5.2 OAuth edge functions

- `oauth-start` accepts `provider` (`google` default). Per provider: the
  authorize URL, the scopes, and whether PKCE/offline parameters are sent.
  Config from secrets: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
  for Facebook; `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` for Instagram Login
  (Meta issues a distinct app id for it); the redirect URI is the one
  `oauth-callback` function for all three.
- `oauth-callback` consumes the state, reads its provider, and hands the code
  to that provider's adapter (`_shared/oauth-meta.ts`): exchange, upgrade to
  long-lived, identify the one page / the Instagram account, and seal
  `{access_token, refresh_token, expires_at, provider}`. Facebook stores the
  **page** token with no refresh token and a ten-year `expires_at` (Meta: page
  tokens from long-lived user tokens do not expire). Instagram stores the
  60-day token with `refresh_token` equal to itself.
- Google's path is untouched except that the sealed object now carries
  `provider: "google"` and the pending row carries `platform: "youtube"`.
- The worker gateway's `issueToken` reads `provider` from the opened seal:
  `google` renews as today; `instagram` calls `refresh_access_token` (a 190
  error is `RevokedError`, so the channel asks to be reconnected); `facebook`
  never renews.
- New refusal codes the `/connected` page translates: `meta_no_page`,
  `meta_scope_missing`, `instagram_not_professional`,
  `meta_token_exchange_failed`; `ambiguous_channel` and `declined` are reused.

### 5.3 Public lookup (`channel-lookup`)

Two new branches, with the handle parsing in a tested module
`_shared/meta-handles.ts`:
- Instagram: `instagram.com/<user>` or `@user` → `^[A-Za-z0-9_.]{1,30}$`;
  names via `GET https://www.instagram.com/api/v1/users/web_profile_info/?username=`
  with Instagram's web app id header, 6-second timeout; refusal → bare-handle
  candidate with `fallback_available: true`.
- Facebook: `facebook.com/<page>`, `/pages/<name>/<id>`, `/profile.php?id=<n>`
  → vanity `^[A-Za-z0-9.]{1,80}$` or numeric id; names via the page's
  `og:title`/`og:image`; same fallback.

### 5.4 Worker

- `collectors/meta_graph.py`: one Graph API client used by both connected
  collectors: bearer, cursor pagination (`paging.cursors.after` becomes the
  checkpoint), error mapping — 190 → `invalid_credentials` (blocked),
  4/17/32/613 → `rate_limit_exceeded` (retryable), 10/200/230 →
  `permission_missing` (blocked), 100 → `api_error` (failed), 803/24 →
  `channel_not_found` (failed).
- `collectors/facebook_collector.py` and `collectors/instagram_collector.py`,
  the X/TikTok shape: `catalogue()` and `batches()`, fixture mode, a
  `preferred_scraper`, and the cascade **scraper → Graph API** for a public
  row (handle, no token) or **Graph API only** for a connected row (token, no
  handle; the subject id comes from `/me`). Every date missing from the
  source is `None` with precision `unknown`; every missing like count is
  `None`; a refused or short read raises `CollectionError`, never yields an
  empty exhausted batch.
- `scrapers/apify.py` and `scrapers/brightdata.py`: `scrape_facebook_posts`,
  `scrape_facebook_comments`, `scrape_instagram_posts`,
  `scrape_instagram_comments`, with actor/dataset ids injectable.
- `router.py`, `server/loop.py`: route `facebook` and `instagram`; new env
  `FACEBOOK_SCRAPER_PROVIDER`, `INSTAGRAM_SCRAPER_PROVIDER`,
  `APIFY_FACEBOOK_POSTS_ACTOR`, `APIFY_FACEBOOK_COMMENTS_ACTOR`,
  `APIFY_INSTAGRAM_POSTS_ACTOR`, `APIFY_INSTAGRAM_COMMENTS_ACTOR`.
- Sources added to `KNOWN_COMMENT_SOURCES`: `facebook_graph_api`,
  `facebook_apify`, `facebook_brightdata`, `instagram_graph_api`,
  `instagram_apify`, `instagram_brightdata`.

### 5.5 Web

- `account/publicPlatforms.ts`: a registry of the five non-YouTube platforms
  (clean function, string keys, test-id prefix) replacing the three copied
  Telegram/X/TikTok forms in `WorkspaceCard.tsx` with one
  `account/PublicHandleForm.tsx`; test ids and behaviour unchanged, Facebook
  and Instagram added. The card shrinks.
- The owner door gains a provider choice: three buttons (YouTube, Facebook,
  Instagram) where "Connect a YouTube channel" was; `beginConnect` carries
  `provider`; test id `connect-<ws>` stays on the YouTube button.
- `catalogue.ts` `videoLinks` for both platforms; `FilterBar` lists all six
  platforms enabled; `CataloguePreview`/`Catalogue`/`WorkspaceCard` platform
  labels via one `platformLabel(platform, S)` helper.
- Strings (ar/en): add-forms, connect buttons, connect-result codes, "open on
  Facebook/Instagram", catalogue running details.

### 5.6 Tests (each new test is shown red on the old code)

- Python: `test_meta_graph.py`, `test_facebook_collector.py`,
  `test_instagram_collector.py`, additions to `test_apify_scraper.py`,
  `test_brightdata_scraper.py`, `test_router.py`, `test_omnichannel_e2e.py`.
- Supabase (PGlite): provider stored on the state and returned to the
  service; Meta pending rows refuse a UC id and accept a numeric one; attach
  keys on platform; a second workspace cannot seize a connected page.
- Edge (vitest, no network): `oauth_callback.test.ts` Meta adapters;
  `meta_handles.test.ts`.
- Web: `publicPlatforms.test.ts`, `WorkspaceCard.test.tsx` (FB/IG forms,
  provider buttons), `connect.test.ts` (provider in the body),
  `connectResult.test.ts` (new codes), `catalogue.test.ts` (links).

## 6. Left to the builder

File layout inside the named modules, exact fixture texts (Arabic, synthetic),
and the order of commits. Nothing in §5 is optional.
