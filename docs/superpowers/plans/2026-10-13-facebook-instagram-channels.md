# Facebook and Instagram channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace can follow a Facebook page or an Instagram account through either door (owner OAuth, or public collection by managed scraper), with posts, comments, counts and the usual classification.

**Architecture:** The worker gains two collectors of the X/TikTok shape backed by one Meta Graph client and the existing Apify/Bright Data clients. The OAuth edge functions gain a `provider` carried on the state row and a Meta adapter; the lookup function gains two naming branches. The web account card gets a platform registry that replaces three copied forms, plus a provider choice on the owner door.

**Tech Stack:** Python 3.12 + httpx (worker), Deno edge functions (TypeScript), Postgres/PGlite SQL, React 19 + Zod (web), vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-13-facebook-instagram-channels-design.md`

## Global Constraints

- Invariants of `docs/agents/CONTEXT.md` §5: unknown is `None`/`null` never 0 or `now()`; a short or refused read is `partial`/`failed`/`blocked`, never an empty exhausted batch; tenant from credential.
- Migration file: `supabase/migrations/20261026000000_meta_oauth_providers.sql`; immutable afterwards.
- Every user-facing string exists in both `apps/web/src/strings/ar.ts` and `en.ts`.
- `apps/web/src/account/WorkspaceCard.tsx` must end shorter than 1,052 lines; every new file ≤ 400 lines.
- No network in tests; Apify/Bright Data/Graph are mocked with `httpx.MockTransport` or `vi.fn`.
- Each new test is run once against the pre-task code (red) before the implementation step (green); the commit message cites the test.
- Graph API version `v25.0`. Apify actors: `apify/facebook-posts-scraper`, `apify/facebook-comments-scraper`, `apify/instagram-post-scraper`, `apify/instagram-comment-scraper`. Bright Data datasets: FB posts `gd_lkaxegm826bjpoo9m5`, FB comments `gd_lkay758p1eanlolqw8`, IG posts `gd_lk5ns7kz21pck8jpis`, IG comments `gd_ltppn085pokosxh13`.

## Review Focus

1. A Facebook post whose `created_time` is `2024-05-01T10:00:00+0000` (Meta's non-ISO offset) must parse to `2024-05-01T10:00:00+00:00`, never fall to `None` — test in Task 2.
2. A Graph error `{"error":{"code":190}}` on a connected channel must end the job `blocked` with `invalid_credentials`, never `exhausted` — tests in Tasks 4 and 5.
3. A pasted Instagram link with a trailing path (`instagram.com/natgeo/reels/`) or query must resolve to `natgeo`; `instagram.com/p/XYZ/` (a post, not a profile) must be refused — test in Task 9.
4. An Instagram seal whose refresh answers 190 must mark the channel `reconnect_required` through `RevokedError`, not retry forever — test in Task 8.
5. The "Connect" test id `connect-<ws>` must still fire `onConnect` with provider `google` so `tests/e2e/account.spec.ts` and `WorkspaceCard.test.tsx` keep passing — test in Task 11.

---

### Task 1: Contracts and strings

**Files:**
- Modify: `packages/contracts/src/comments.ts:39-55` (KNOWN_COMMENT_SOURCES)
- Modify: `apps/web/src/strings/en.ts`, `apps/web/src/strings/ar.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Produces: sources `facebook_graph_api`, `facebook_apify`, `facebook_brightdata`, `instagram_graph_api`, `instagram_apify`, `instagram_brightdata`.
- Produces string keys (same in ar/en): `addFacebookChannel`, `addFacebookLead`, `addFacebookPlaceholder`, `addFacebookInvalidHandle`, `addInstagramChannel`, `addInstagramLead`, `addInstagramPlaceholder`, `addInstagramInvalidHandle`, `connectFacebookPage`, `connectInstagramAccount`, `connectProviderLead`, `jobCatalogueRunningDetailFacebook`, `jobCatalogueRunningDetailInstagram`, `catOpenFacebook`, `catOpenInstagram`, `crMetaNoPage`, `crMetaScopeMissing`, `crInstagramNotProfessional`, `crMetaTokenExchangeFailed`.

- [ ] Step 1: Add to `contracts.test.ts` a test `KNOWN_COMMENT_SOURCES names both Meta doors` asserting the six sources are present.
- [ ] Step 2: `npx vitest run packages/contracts/src/contracts.test.ts` → FAIL.
- [ ] Step 3: Add the sources; add the strings (English and Arabic, RTL-safe, no platform jargon beyond the platform names).
- [ ] Step 4: `npx vitest run packages/contracts/src/contracts.test.ts` and `npm run typecheck` → PASS.
- [ ] Step 5: Commit `feat(contracts,strings): name the Meta sources and the Facebook/Instagram copy`.

### Task 2: Meta Graph client

**Files:**
- Create: `workers/python/src/collectors/meta_graph.py`
- Test: `workers/python/tests/test_meta_graph.py`

**Interfaces:**
- `GRAPH_FACEBOOK = "https://graph.facebook.com/v25.0"`, `GRAPH_INSTAGRAM = "https://graph.instagram.com/v25.0"`.
- `parse_graph_time(value: object) -> tuple[str | None, str]` → `(iso_utc_or_None, precision)` where precision is `"second"` or `"unknown"`; accepts `+0000` offsets, ISO with `Z`, and unix ints; anything else → `(None, "unknown")`.
- `graph_error(status: int, body: object) -> CollectionError` mapping: 190 → `invalid_credentials` blocked; 4, 17, 32, 613 → `rate_limit_exceeded` failed retryable; 10, 200, 230 → `permission_missing` blocked; 803, 24 → `channel_not_found` failed; 100 → `api_error` failed; status ≥ 500 → `source_unavailable` failed retryable; else `api_error`.
- `class MetaGraphClient(client: httpx.Client, access_token: str, base_url: str, timeout: float = 20.0)` with `get(path: str, params: dict[str, str] | None = None) -> dict` (raises `CollectionError("network_failure", retryable=True)` on transport errors, `graph_error` on `is_error`, `invalid_response_format` on non-JSON) and `page(path, params, after: str | None) -> tuple[list[dict], str | None]` returning `data` and `paging.cursors.after` only when `paging.next` is present.

- [ ] Step 1: Tests: `test_parse_graph_time_accepts_meta_offset` (`"2024-05-01T10:00:00+0000"` → `("2024-05-01T10:00:00+00:00","second")`), `test_parse_graph_time_unknown_is_none` (`None`, `"yesterday"` → `(None,"unknown")`), `test_graph_error_mapping` (table above), `test_page_returns_cursor_only_when_next_exists`, `test_get_sends_bearer_and_maps_190`.
- [ ] Step 2: `uv --directory workers/python run --frozen pytest tests/test_meta_graph.py -v` → FAIL (import error).
- [ ] Step 3: Implement the module.
- [ ] Step 4: Run → PASS. `npm run worker:lint` → clean.
- [ ] Step 5: Commit `feat(worker): one Meta Graph client with coded refusals and cursor paging`.

### Task 3: Apify and Bright Data: Facebook and Instagram methods

**Files:**
- Modify: `workers/python/src/collectors/scrapers/apify.py`, `workers/python/src/collectors/scrapers/brightdata.py`
- Test: `workers/python/tests/test_apify_scraper.py`, `workers/python/tests/test_brightdata_scraper.py`

**Interfaces:**
- `ApifyClient.__init__` gains `facebook_posts_actor`, `facebook_comments_actor`, `instagram_posts_actor`, `instagram_comments_actor` (defaults from Global Constraints).
- `scrape_facebook_posts(handle: str, max_items: int = 25) -> list[dict]` input `{"startUrls":[{"url":"https://www.facebook.com/<handle>/"}],"resultsLimit":max_items}`; each video dict: `external_video_id` = `postId` or last path segment of `url`; `kind` = `"video"` when any `media[].__typename == "Video"` else `"channel_post"`; `published_at` = `time` (ISO) or `timestamp` (unix) else `None`; `reported_comment_count` = int `comments` or `None`; `thumbnail_url` = first media `thumbnail`/`photo_image.uri`/`image.uri` or `None`; `field_provenance` = `{"source":"apify","actor":…, "handle":…, "url": item.url}`.
- `scrape_facebook_comments(post_id: str, handle: str | None = None, max_items: int = 50) -> list[dict]` URL `https://www.facebook.com/<handle or 'facebook'>/posts/<post_id>`, input adds `includeNestedComments: True`; comment dict keys as X: `id` (= `commentId` or `id`), `video_id`, `text`, `parent_id` (= `replyToCommentId` or `parentComment.id` or `None`), `is_reply`, `published_at` (`date` ISO or `None`), `author_name` (`profileName`), `author_channel_id` (`profileId` or `None`), `likes_value` (int of `likesCount` or `None`).
- `scrape_instagram_posts(handle, max_items=25)` input `{"username":[handle],"resultsLimit":max_items,"dataDetailLevel":"basicData"}`; `external_video_id` = `shortCode` (fallback `id`); kind: `type=="Video"` and `productType=="clips"` → `short`, `Video` → `video`, else `channel_post`; `published_at` = `timestamp` or `None`; `reported_comment_count` = `commentsCount` or `None`; `thumbnail_url` = `displayUrl`; provenance adds `media_id`.
- `scrape_instagram_comments(shortcode, max_items=50)` input `{"directUrls":["https://www.instagram.com/p/<shortcode>/"],"resultsLimit":max_items}`; `id`, `text`, `published_at` (`timestamp`), `author_name` (`ownerUsername`), `author_channel_id` (`owner.id`), `likes_value` (`likesCount` or `None`), `parent_id` = `parentCommentId` or `None`.
- `BrightDataClient.__init__` gains `dataset_facebook_posts`, `dataset_facebook_comments`, `dataset_instagram_posts`, `dataset_instagram_comments` (defaults from Global Constraints) and the same four method names/shapes, tolerant to `post_id|shortcode`, `content|description|caption`, `date_posted`, `num_comments`, `comment_id`, `comment_text|comment`, `date_created|comment_date`, `user_name|comment_user`, `user_id`, `num_likes|likes_number`.

- [ ] Step 1: Tests (one per method per client, assert URL/actor path, bearer, mapped fields, and that a missing `comments` count maps to `None` and a missing date to `None`).
- [ ] Step 2: Run both files → FAIL (`AttributeError`).
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS; lint clean.
- [ ] Step 5: Commit `feat(worker): Apify and Bright Data read Facebook pages and Instagram accounts`.

### Task 4: Facebook collector

**Files:**
- Create: `workers/python/src/collectors/facebook_collector.py`
- Test: `workers/python/tests/test_facebook_collector.py`

**Interfaces:**
- `class FacebookCollector` with `source = "facebook_graph_api"`, `revision = "facebook-adapter-v1"`; `__init__(channel_id=None, client=None, access_token=None, apify_client=None, brightdata_client=None, fixture_data=None, preferred_scraper=None)`.
- `_clean_handle(str) -> str`: strips `https?://(www.|m.|web.)?facebook.com/`, `profile.php?id=<n>` → `<n>`, `pages/<name>/<id>` → `<id>`, trailing path/query; result must match `^[A-Za-z0-9.]{1,80}$` or `^[0-9]{1,64}$` else `ValueError("invalid_channel_id")`.
- `_clean_post_id(str) -> str`: last path segment; must match `^([0-9]{1,30}(_[0-9]{1,30})?|pfbid[A-Za-z0-9]{10,120})$` else `ValueError("invalid_video_id")`.
- `catalogue(channel_id=None) -> Catalogue`: fixture → scrapers (preferred first, then Apify, then Bright Data) → Graph (`/me?fields=id,name,username`, then `/{id}/posts?fields=id,message,story,created_time,permalink_url,full_picture,attachments{media_type},comments.summary(true).limit(0)&limit=50`, walk cursors up to 200 posts, `complete=False, reason="catalogue_capped"` when capped). Graph post → `external_video_id` = the part after `_` of the Graph id when present, else the id; `kind` `video` when any attachment `media_type == "video"` else `channel_post`; `reported_comment_count` = `comments.summary.total_count` or `None`.
- `batches(video_id, checkpoint=None, since=None, max_items=None, **kw)`: connected (token) → Graph `/{page_id}_{post_id}/comments?fields=id,message,created_time,from,like_count,parent{id}&filter=stream&limit=100` with `after=checkpoint` (page id learned from `/me` and cached on the instance); `outcome="partial"` with the next cursor while `paging.next`, `exhausted` on the last page. Public (no token) → scraper cascade; empty list from every configured scraper → `Batch([], None, "exhausted")` only if at least one scraper answered without error; no scraper configured → `CollectionError("comments_scraper_not_configured","blocked")`.
- `RawComment.platform = "facebook"`, `source` = `facebook_graph_api` | `facebook_apify` | `facebook_brightdata`, `timestamp_precision` from `parse_graph_time`, `likes_value=None` when unknown.

- [ ] Step 1: Tests: `test_facebook_collector_validates_handle_and_post_id` (URL forms above), `test_facebook_fixture_catalogue_and_batches`, `test_facebook_graph_catalogue_and_paged_comments` (two comment pages → first batch partial with checkpoint, second exhausted; `+0000` time parsed; missing `like_count` → `None`), `test_facebook_graph_190_is_blocked_invalid_credentials`, `test_facebook_public_cascade_apify_then_brightdata`, `test_facebook_public_without_scrapers_is_blocked`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS; lint.
- [ ] Step 5: Commit `feat(worker): Facebook page collector, Graph for the owner and scrapers for the public`.

### Task 5: Instagram collector

**Files:**
- Create: `workers/python/src/collectors/instagram_collector.py`
- Test: `workers/python/tests/test_instagram_collector.py`

**Interfaces:**
- `class InstagramCollector`, `source = "instagram_graph_api"`, `revision = "instagram-adapter-v1"`, same constructor as Task 4.
- `_clean_handle`: strips `https?://(www.)?instagram.com/`, leading `@`, trailing path/query; refuses `p/`, `reel/`, `reels/`, `explore/`, `stories/` as a handle (`ValueError("invalid_channel_id")`); result `^[A-Za-z0-9_.]{1,30}$`.
- `_clean_media_id`: last path segment; `^[0-9]{5,30}$` (Graph media id) or `^[A-Za-z0-9_-]{5,40}$` (shortcode).
- `catalogue`: fixture → scrapers → Graph (`/me?fields=user_id,username,name`, then `/me/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,comments_count&limit=50`, cap 200). Kind: `media_product_type == "REELS"` → `short`, `media_type == "VIDEO"` → `video`, else `channel_post`.
- `batches`: connected → `/{media_id}/comments?fields=id,text,timestamp,username,like_count,replies{id,text,timestamp,username,like_count}&limit=50` with cursor; replies flattened as `is_reply=True, parent_id=<comment id>, parent_source="instagram_reply"`. Public → cascade as Task 4.

- [ ] Step 1: Tests mirroring Task 4 plus `test_instagram_handle_refuses_post_links` and `test_instagram_graph_replies_are_flattened`.
- [ ] Step 2: Run → FAIL. Step 3: Implement. Step 4: PASS + lint.
- [ ] Step 5: Commit `feat(worker): Instagram collector, Graph for the owner and scrapers for the public`.

### Task 6: Worker wiring and environment

**Files:**
- Modify: `workers/python/src/collectors/router.py`, `workers/python/src/server/loop.py:56-165,340-380`, `.env.example`
- Test: `workers/python/tests/test_router.py`, `workers/python/tests/test_omnichannel_e2e.py`

**Interfaces:**
- `CollectorRouter.__init__` gains `facebook_builder`, `instagram_builder`; `get_collector("facebook"|"instagram", channel_id, token)` returns the builder's answer or a default collector.
- `build_collector(...)` gains `facebook_fixture`, `instagram_fixture`, `apify_facebook_posts_actor`, `apify_facebook_comments_actor`, `apify_instagram_posts_actor`, `apify_instagram_comments_actor`, `facebook_scraper_provider`, `instagram_scraper_provider`; `build()` returns `FacebookCollector`/`InstagramCollector` for those platforms with `access_token=token` (no env fallback token: Meta grants are per channel).
- Env names: `FACEBOOK_SCRAPER_PROVIDER`, `INSTAGRAM_SCRAPER_PROVIDER`, `APIFY_FACEBOOK_POSTS_ACTOR`, `APIFY_FACEBOOK_COMMENTS_ACTOR`, `APIFY_INSTAGRAM_POSTS_ACTOR`, `APIFY_INSTAGRAM_COMMENTS_ACTOR`.

- [ ] Step 1: Change `test_router.py` to expect routing (not `platform_facebook_collector_not_configured`); add `test_e2e_facebook_pipeline_success`, `test_e2e_instagram_pipeline_success`, `test_e2e_instagram_graph_190_blocked` to the e2e file using `MockControlPlaneRecorder` and `_discover`/`_backfill`.
- [ ] Step 2: Run → FAIL. Step 3: Implement; add the env lines to `.env.example`. Step 4: `npm run worker:test` → PASS.
- [ ] Step 5: Commit `feat(worker): route Facebook and Instagram leases; operator picks the scraper per platform`.

### Task 7: Migration: providers on the OAuth state, platform on the pending row

**Files:**
- Create: `supabase/migrations/20261026000000_meta_oauth_providers.sql`
- Test: `supabase/tests/oauth.test.ts`

**Interfaces (SQL):**
- `public.oauth_start(w uuid, c uuid, state_hash text, verifier text, browser_nonce_hash text, p_provider text default 'google') returns text` (old 5-arg dropped; impl likewise; provider must be in `('google','facebook','instagram')` else `invalid_provider` 22023).
- `public.svc_oauth_consume_state(state_hash text) returns table(state_id uuid, user_id uuid, workspace_id uuid, client_id uuid, code_verifier text, browser_nonce_hash text, provider text)` (dropped and recreated; impl likewise).
- `public.svc_oauth_create_pending(state_id uuid, ticket_hash text, external_channel text, tokens bytea, key_version text, scopes text[], channel_handle text default null, channel_title text default null, pending_platform text default 'youtube')` (dropped and recreated; the id regex per platform).
- `private.oauth_attach_channel_for(u, w, c, external_channel, tokens, key_version, scopes, channel_handle default null, channel_title default null, p_platform text default 'youtube') returns uuid`; `private.oauth_complete_impl` recreated to pass `pending.platform`.
- Grants: `authenticated` → `oauth_start`, `oauth_complete`; `service_role` → `svc_oauth_consume_state`, `svc_oauth_create_pending`; `revoke … from public, anon` on all.

- [ ] Step 1: Tests in `oauth.test.ts`: `stores the provider on the state and hands it back to the service` (start with `p_provider:'facebook'`, consume → `provider === 'facebook'`), `refuses an unknown provider`, `a Meta pending row refuses a UC id and accepts a numeric page id`, `attaches a Facebook page under its own platform and keeps YouTube rows apart` (same external id string on both platforms coexist in one workspace), `will not let a second workspace seize a connected page`.
- [ ] Step 2: `npx vitest run supabase/tests/oauth.test.ts` → FAIL. Step 3: Write the migration. Step 4: PASS; `npm run test:db` green.
- [ ] Step 5: Commit `feat(db): OAuth states carry a provider and pending grants a platform (Meta)`.

### Task 8: Edge: Meta OAuth adapters, start/callback branching, gateway renewal

**Files:**
- Create: `supabase/functions/_shared/oauth-meta.ts`
- Modify: `supabase/functions/_shared/oauth-start.ts` (`OauthConfig.provider`, authorize URL per provider), `supabase/functions/_shared/oauth-callback.ts` (`CallbackDb.consumeState` returns `provider`; `createPending` takes `platform`; `handleCallback` takes `meta?: MetaConfig` and branches), `supabase/functions/oauth-start/index.ts`, `supabase/functions/oauth-callback/index.ts`, `supabase/functions/worker/index.ts:40-125`
- Test: `supabase/tests/oauth_start.test.ts`, `supabase/tests/oauth_callback.test.ts`, `supabase/tests/oauth_meta.test.ts`

**Interfaces:**
- `export type Provider = "google" | "facebook" | "instagram"`.
- `oauth-start.ts`: `OauthConfig` gains `provider: Provider` (default google); for `facebook` the URL is `https://www.facebook.com/v25.0/dialog/oauth` with `client_id, redirect_uri, state, response_type=code, scope=pages_show_list,pages_read_engagement,pages_read_user_content` (no PKCE, no `access_type`); for `instagram` `https://www.instagram.com/oauth/authorize` with `client_id, redirect_uri, state, response_type=code, scope=instagram_business_basic,instagram_business_manage_comments, enable_fb_login=0`. `beginAuthorization(workspace, client, config, db, random)` passes `config.provider` to `db.createState(..., provider)`.
- `oauth-meta.ts`: `MetaConfig = { app_id, app_secret, ig_app_id, ig_app_secret, redirect_uri, key_version }`; `connectFacebookPage(code, config, http) -> {external_channel, handle, title, tokens:{access_token, refresh_token:"", expires_at, provider:"facebook"}, scopes}` (exchange → `fb_exchange_token` long-lived → `GET /me/accounts?fields=id,name,username,access_token`; 0 pages → `ConnectError("meta_no_page")`, >1 → `ambiguous_channel`; `expires_at` = now + 3650 days); `connectInstagramAccount(code, config, http)` (exchange `POST https://api.instagram.com/oauth/access_token` form → `ig_exchange_token` → `GET https://graph.instagram.com/v25.0/me?fields=user_id,username,name`; missing `user_id` → `instagram_not_professional`; tokens `refresh_token = access_token`, `expires_at` from `expires_in`, `provider:"instagram"`); `refreshInstagramToken(accessToken, http)` (190 → `RevokedError`); exchange failures → `meta_token_exchange_failed`; a `(#10)`/`(#200)` on identify → `meta_scope_missing`.
- `handleCallback` seals `{access_token, refresh_token, expires_at, provider}` for every provider (`google` on the Google path) and passes `platform` (`youtube`/`facebook`/`instagram`) to `createPending`.
- `worker/index.ts` `issueToken`: opened seal `provider` default `"google"`; `facebook` → return as is; `instagram` → `refreshInstagramToken`; `google` → unchanged.
- `oauth-start/index.ts`: body `provider?: string` validated against the three; secrets `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`; missing → 500 `oauth_not_configured`.

- [ ] Step 1: Tests: `oauth_start.test.ts` — `facebook builds Meta's dialog with the page scopes and no PKCE`, `instagram asks the Instagram window with the business scopes`, `the provider is stored with the state`; `oauth_meta.test.ts` — `connectFacebookPage exchanges, upgrades, and picks the one page`, `two pages is ambiguous, none is meta_no_page`, `connectInstagramAccount stores a self-refreshing 60-day token`, `refreshInstagramToken turns 190 into RevokedError`; `oauth_callback.test.ts` — `a facebook state goes to the Meta adapter and files platform facebook`.
- [ ] Step 2: Run the three files → FAIL. Step 3: Implement. Step 4: PASS; `npm run typecheck`.
- [ ] Step 5: Commit `feat(oauth): Facebook pages and Instagram accounts connect through the same state, ticket and seal`.

### Task 9: Edge: lookup names Facebook pages and Instagram accounts

**Files:**
- Create: `supabase/functions/_shared/meta-handles.ts`
- Modify: `supabase/functions/channel-lookup/index.ts` (two branches before the YouTube path; `Candidate.platform` union gains both)
- Test: `supabase/tests/meta_handles.test.ts`

**Interfaces:**
- `parseInstagramHandle(raw: string): string | null` (rules of Task 5 `_clean_handle`, returns `null` instead of throwing).
- `parseFacebookHandle(raw: string): string | null` (rules of Task 4).
- `instagramProfileCandidate(handle, http, timeout=6000)` → `GET https://www.instagram.com/api/v1/users/web_profile_info/?username=<h>` with header `x-ig-app-id: 936619743392459`; on 200 with `data.user` → `{external_channel_id: handle, handle:"@"+handle, title: full_name||handle, thumbnail_url: profile_pic_url||null, platform:"instagram"}`; on 404 → `LookupError("channel_not_found",404)`; anything else → bare candidate + `fallback_available`.
- `facebookPageCandidate(handle, http)` → `GET https://www.facebook.com/<handle>/` (`user-agent: facebookexternalhit/1.1`), `og:title`/`og:image`; 404 → `channel_not_found`; else bare candidate + fallback.

- [ ] Step 1: Tests for both parsers (Review Focus 3 cases) and both candidate builders with a stubbed `http`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat(lookup): a Facebook page or Instagram account is named from its link`.

### Task 10: Web: platform registry and one public-handle form

**Files:**
- Create: `apps/web/src/account/publicPlatforms.ts`, `apps/web/src/account/PublicHandleForm.tsx`
- Modify: `apps/web/src/account/WorkspaceCard.tsx` (remove the Telegram/X/TikTok handle state, cleaners, handlers and the three forms; render `PublicHandleForm` for `addPlatform !== "youtube"`; platform buttons from the registry)
- Test: `apps/web/src/account/publicPlatforms.test.ts`, `apps/web/src/account/WorkspaceCard.test.tsx`

**Interfaces:**
- `export type PublicPlatform = "telegram" | "x" | "tiktok" | "facebook" | "instagram"`.
- `export const PUBLIC_PLATFORMS: Record<PublicPlatform, { label: StringKey; heading: StringKey; lead: StringKey; placeholder: StringKey; invalid: StringKey; testId: string; clean: (raw: string) => string | null; candidate: (clean: string) => ChannelCandidate }>` with `testId` `addtelegram|addx|addtiktok|addfacebook|addinstagram`; `candidate` reproduces today's shapes exactly (Telegram `handle: s, title: s`; X/TikTok/Instagram `"@"+s`; Facebook `handle: s, title: s`).
- `PublicHandleForm({ platform, workspaceId, pending, lookupErrorPresent, onSearch(clean), onAdd(candidate), onCancel(), onClearError() })` renders label/input/`-search`/`-submit`/`-close` with the existing test ids and the `addDirectAvailableDesc` note.

- [ ] Step 1: `publicPlatforms.test.ts`: cleaners for all five (existing X/TikTok/Telegram cases copied from the card tests; Facebook `https://www.facebook.com/profile.php?id=123` → `123`, `facebook.com/pages/Name/456` → `456`, `m.facebook.com/aljazeera/` → `aljazeera`; Instagram per Review Focus 3); `WorkspaceCard.test.tsx`: `switches to Facebook and adds a page by link`, `switches to Instagram and adds an account by handle`, invalid-input cases, badge cases.
- [ ] Step 2: FAIL. Step 3: Implement; the card must shrink. Step 4: `npx vitest run apps/web/src/account` → PASS (all existing tests unchanged).
- [ ] Step 5: Commit `refactor(account): one public-handle form for five platforms; Facebook and Instagram added`.

### Task 11: Web: owner door chooses the provider

**Files:**
- Modify: `apps/web/src/connect.ts` (`beginConnect(workspaceId, clientId, provider: Provider = "google")`, body gains `provider`), `apps/web/src/connectResult.ts` (FAILURES gains `meta_no_page`, `meta_scope_missing`, `instagram_not_professional`, `meta_token_exchange_failed`), `apps/web/src/account/WorkspaceCard.tsx` (`onConnect: (provider: ConnectProvider) => void`; three buttons; `connect-<ws>` stays on YouTube; `connect-facebook-<ws>`, `connect-instagram-<ws>`), `apps/web/src/account/Account.tsx:602-614,948-955`
- Test: `apps/web/src/connect.test.ts`, `apps/web/src/connectResult.test.ts`, `apps/web/src/account/WorkspaceCard.test.tsx`

- [ ] Step 1: Tests: `sends the provider the card chose` (body contains `provider:"instagram"`), `omits nothing: google is sent explicitly`; `connectResult` names the four Meta codes; card: `the Facebook door asks for provider facebook`, `the YouTube door still answers google on connect-<ws>` (Review Focus 5).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS; `tests/e2e` untouched.
- [ ] Step 5: Commit `feat(account): connect a Facebook page or an Instagram account beside YouTube`.

### Task 12: Web: links, filter, labels

**Files:**
- Create: `apps/web/src/platformLabel.ts` (`platformLabel(platform: string | null | undefined, S: Strings): string`)
- Modify: `apps/web/src/catalogue.ts:185-235` (`facebook` → `https://www.facebook.com/<handle>/posts/<id>` or `https://www.facebook.com/<id>`; `instagram` → `https://www.instagram.com/p/<id>/` when the id is a shortcode, else `https://www.instagram.com/<handle>/`; `embed: null`), `apps/web/src/dashboard/FilterBar.tsx:219-245` (all six enabled; `platformSoon` no longer used there), `apps/web/src/ops/Catalogue.tsx`, `apps/web/src/ops/CataloguePreview.tsx`, `apps/web/src/account/WorkspaceCard.tsx` (use `platformLabel` in the nested ternaries)
- Test: `apps/web/src/catalogue.test.ts`, `apps/web/src/platformLabel.test.ts`

- [ ] Step 1: Tests for the four link shapes and for `platformLabel` on all six plus unknown (returns the raw value).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: `npm test` → PASS.
- [ ] Step 5: Commit `feat(web): open on Facebook/Instagram, filter by every platform`.

### Task 13: Docs, full check, pull request

**Files:**
- Modify: `supabase/functions/README.md` (secrets table: five Meta secrets), `docs/oauth-connect-flow.md` (§8 note), `docs/decisions.md`, `docs/progress.md`, `docs/agents/CONTEXT.md` §1 (platform list)

- [ ] Step 1: Write the entries (decision record: why managed scrapers, the two-row limitation, kinds mapping, costs).
- [ ] Step 2: `npm run check` → paste the real summary; `npm run test:e2e` if the account spec is touched.
- [ ] Step 3: Commit `docs: record the Facebook/Instagram doors, their secrets and their costs`.
- [ ] Step 4: Push `claude/meta-channels`; open a draft PR "feat: Facebook and Instagram channels through owner consent and managed scrapers" whose body lists what is live-tested (nothing until the owner sets the secrets) versus fixture-tested; mark ready for the gates.
