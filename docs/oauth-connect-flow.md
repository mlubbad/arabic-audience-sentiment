# Connecting a YouTube channel — the flow, screen by screen

2026-09-16 (updated 2026-09-19 upon Google OAuth verification approval). This is the formal record — every screen, every URL, every source file behind it.

## 0. Why this exists

`docs/youtube-quota-extension.md` covers the API-usage side of the OAuth grant (scopes, quota, retention); this covers the **user experience** of getting from "ربط قناة يوتيوب" to a working connection.

Following Google OAuth verification approval in production (verified application), the intermediate "before you continue" warning question and Google's unverified warning screen were removed. Clicking "ربط قناة يوتيوب" or "إعادة الربط لحفظ اسم القناة" now navigates directly to Google OAuth.

## 1. The screens, in order

| # | Screen | URL | Source |
| --- | --- | --- | --- |
| 1 | Account page, connect button | `/account` | `apps/web/src/account/WorkspaceCard.tsx` |
| 2 | Google account chooser | `accounts.google.com/v3/signin/accountchooser` | Google's own |
| 3 | Scope consent ("… wants access to your Google Account") | `accounts.google.com/signin/oauth/v2/consentsummary` | Google's own |
| 4 | Redirect back, success or error | `/connected` | `apps/web/src/Connected.tsx` |

*(Historical note: Prior to Google OAuth verification approval, an inline warning card was shown before redirecting to warn users about Google's unverified app screen. Both were retired once verification succeeded on 2026-09-19.)*

## 2. Screen 1: The connect and relink doors

Pressing "ربط قناة يوتيوب" (`WorkspaceCard.tsx`, `data-testid="connect-{workspaceId}"`) or "إعادة الربط لحفظ اسم القناة" (`data-testid="relink-{workspaceId}"`) calls `beginConnect()` (`apps/web/src/connect.ts`) and navigates directly to Google OAuth.

## 3. Screen 2: the account chooser

Standard Google UI, unaffected by this project's own configuration beyond the domain it
names as the continuing party — see §4 for why that domain, not "Audience Sentiment",
appears here.

## 4. Screen 4: "Google hasn't verified this app" — why, and why the branding change did not remove it

The OAuth client requests `youtube.force-ssl` (`supabase/functions/oauth-start/index.ts`),
which Google classifies as a **sensitive scope** — required because `commentThreads.list`
on the owner's own videos refuses `youtube.readonly` alone with `insufficientPermissions`,
and Google offers no narrower scope for reading comments as the channel owner. Any OAuth
client requesting a sensitive scope shows this warning to every user, and displays the
**raw authorized domain** instead of the configured app name, until the client passes
Google's own **OAuth verification** — a review process separate from, and in addition to,
the YouTube API quota-and-audit request already submitted (`docs/youtube-quota-extension.md`).

Setting the OAuth consent screen's "App name" to "Audience Sentiment" (done 2026-09-16) is
still correct and necessary — it is what verification checks, and it is what will display
once verification passes — but it does not, by itself, remove this screen. Nothing in this
codebase can remove it either: it is Google's UI, shown for every unverified client
requesting a sensitive scope, regardless of branding.

## 5. The one open item: OAuth verification

Verification is a written submission plus a short screen recording of the consent flow,
reviewed by Google (typically days to a few weeks for sensitive-scope, non-restricted
apps — `youtube.force-ssl` (the only scope requested since 2026-09-18; `youtube.readonly` was dropped as redundant) is sensitive, not restricted, so this
does not need the paid third-party security assessment that Gmail- or Drive-scope apps
require). Once approved: screen 4 stops appearing for new connections, and screen 5 shows
"Audience Sentiment wants access…" instead of the Supabase domain. Preparing that
submission (the written justification and a script for the required video) is separate,
follow-up work — the owner's own screen recording is required and cannot be produced here.

## 6. Screen 5: scope consent

Shows the domain (see §4), the account, and the specific access being granted — Google's
own generic description of `youtube.force-ssl` ("See, edit, and permanently delete your
YouTube videos, ratings, comments and captions") is broader-sounding than what this
application actually does with it (read comments and their metadata; never writes).
Nothing here is configurable beyond the scope requested; `docs/youtube-quota-extension.md`
§2 is where the narrower, actual use is stated for Google's reviewer.

## 7. Screen 6: the return

`GET /connected` (`supabase/functions/oauth-callback/index.ts`, redirecting to
`${APP_ORIGIN}/connected`) carries the outcome as query parameters, read by
`apps/web/src/connectResult.ts` and rendered by `apps/web/src/Connected.tsx`. Outcomes
this flow can end in:

| Outcome | Shown as | Cause |
| --- | --- | --- |
| success | "تم ربط القناة" | the token exchanged, the channel identified via `channels.list(mine=true)`, attached |
| `youtube_scope_missing` | a retry prompt | the consent screen's scopes were unchecked; `fetchOwnChannel` in `supabase/functions/_shared/oauth-callback.ts` raises this before any channel is trusted |
| `channel_already_connected` | no retry offered | the channel belongs to another client; disconnect it there first |
| a later `invalid_grant` on refresh | the channel marked `reconnect_required` | the grant was revoked at Google, or expired; `RevokedError` in the same file |

## 8. What this change did not touch

The actual token exchange, channel identification, sealing, and revocation logic
(`supabase/functions/_shared/oauth-callback.ts`, `oauth-start/index.ts`) are unchanged —
this is a UX change to the two buttons that start the redirect, adding one question before
either of them fires. `docs/youtube-quota-extension.md` and `docs/decisions.md` are the
record of the scopes and retention decisions themselves.

## 9. Facebook pages and Instagram accounts (2026-10-13)

The same machinery, two more consent screens. The owner door on the account card is now
three buttons; the state row records which provider it was bound for, the callback hands the
code to that provider's adapter (`supabase/functions/_shared/oauth-meta.ts`), and the sealed
grant carries `provider` so the worker gateway renews it the right way: Google through its
refresh token, Instagram through `refresh_access_token` (sixty days, from itself), a Facebook
page token not at all (it does not expire). Meta documents no PKCE; the hashed state bound to
the browser nonce stays the CSRF protection. One page per Facebook connection; several is
`ambiguous_channel`. The refusals the `/connected` page translates are `meta_no_page`,
`meta_scope_missing`, `instagram_not_professional` and `meta_token_exchange_failed`.

