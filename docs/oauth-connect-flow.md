# Connecting a YouTube channel — the flow, screen by screen

2026-09-16. Written after the owner's own screenshots of the flow showed a screen this
document did not previously exist to explain: Google's "hasn't verified this app" warning.
This is the formal record — every screen, every URL, every source file behind it, and the
one thing about it that is provisional rather than finished.

## 0. Why this exists

No document described this flow start to finish before now. `docs/youtube-quota-extension.md`
covers the API-usage side of the OAuth grant (scopes, quota, retention); this covers the
**user experience** of getting from "ربط قناة يوتيوب" to a working connection, including the
two Google-side warnings a reader will see until [§5](#5-the-one-open-item-oauth-verification)
is closed.

## 1. The screens, in order

| # | Screen | URL | Source |
| --- | --- | --- | --- |
| 1 | Account page, connect button | `/account` | `apps/web/src/WorkspaceCard.tsx` |
| 2 | **New: "before you continue" question** | same page | `apps/web/src/WorkspaceCard.tsx` (this change) |
| 3 | Google account chooser | `accounts.google.com/v3/signin/accountchooser` | Google's own |
| 4 | **"Google hasn't verified this app"** | `accounts.google.com/signin/oauth/warning` | Google's own — see §4 |
| 5 | Scope consent ("… wants access to your Google Account") | `accounts.google.com/signin/oauth/v2/consentsummary` | Google's own |
| 6 | Redirect back, success or error | `/connected` | `apps/web/src/Connected.tsx` |

## 2. Screen 1 → 2: the question this change adds

Pressing "ربط قناة يوتيوب" (`WorkspaceCard.tsx`, `data-testid="connect-{workspaceId}"`) no
longer redirects immediately. It opens a question in place — the same two-step pattern the
disconnect and retire doors already use (`role="group"`, a sentence, two buttons):

- **متابعة إلى Google** (`data-testid="connect-continue-{workspaceId}"`) — only this button
  calls `beginConnect()` (`apps/web/src/connect.ts`) and navigates.
- **إلغاء** (reuses `renameCancel` — the same word, one key, per the codebase's rule against
  a sentence repeated under two keys) — closes the question, nothing happens.

The relink door (`data-testid="relink-{workspaceId}"`, shown when a connected channel has no
stored name) goes through the identical question — it is the same redirect and the same two
warnings on the other side.

The sentence itself (`S.connectAboutGoogle`) says three things before the reader leaves this
page: that the next screen is Google's, that a warning about the app being unverified is
expected and not a sign of risk, and the three buttons on Google's own screens that get past
it (`Advanced` → `Go to … (unsafe)` → `Continue`). Written this way on purpose: a reader who
is told what to expect and why does not abandon the flow at screen 4.

## 3. Screen 3: the account chooser

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
apps — `youtube.force-ssl` and `youtube.readonly` are sensitive, not restricted, so this
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
