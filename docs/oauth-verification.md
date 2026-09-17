# Google OAuth verification — submission materials

2026-09-16. This is the fix for what `docs/oauth-connect-flow.md` §4-5 diagnoses: the
"Google hasn't verified this app" warning and the raw-domain branding, both caused by
requesting a **sensitive scope** (`youtube.force-ssl`) without having passed Google's OAuth
verification. This is a **different process** from the YouTube API quota-and-audit request
already submitted (`docs/youtube-quota-extension.md`) — same underlying facts, different
Google form, and it can be submitted independently of that request's outcome.

Where to submit — confirmed against the live console on 2026-09-16 (the UI is now called
**"Google Auth Platform"**, not "OAuth consent screen"): **Branding** (app name, logo,
homepage, privacy policy, terms, authorized domains — all set 2026-09-16) → **Data
Access** (declare the two scopes under "Add or remove scopes", write the justification,
paste the demo video link, Save) → **Verification Center** (tracks status; this is what
turned from "not required" to "Approval required" once the scopes were declared under
Data Access).

**Not required for this app:** the paid third-party security assessment (CASA). That
applies to *restricted* scopes (full Gmail, full Drive, full Calendar, etc.). Both scopes
here — `youtube.readonly` and `youtube.force-ssl` — are classified **sensitive**, which
Google reviews itself from the written form and the demo video below, typically within
days to a few weeks.

## 1. What the form will ask, and the answers

Google's verification form for a sensitive-scope app collects, per scope requested, a
justification and a demo. The two scopes here share one justification (§2) because the
second scope exists only to unblock the first — see below.

**Scopes requesting verification** (as submitted 2026-09-16; reduced to `force-ssl` alone
on 2026-09-18 — see §5):
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.force-ssl`

**How is this scope used? Why do you need it?** — Google's actual "Data Access" box on
2026-09-16 caps this at **1000 characters** and shares one box across both sensitive
scopes (they are requested together). The exact text pasted there:

```
Audience Sentiment is a read-only YouTube audience-monitoring tool. A signed-in channel
owner authorizes their own channel once via this OAuth flow. youtube.readonly lists the
owner's videos (channels.list, playlistItems.list, videos.list) so they can choose which
to monitor. commentThreads.list on the owner's own videos is refused with
insufficientPermissions under youtube.readonly alone; no narrower scope exists for
reading comments as the channel owner, so youtube.force-ssl is also requested, though the
app never calls any write, update, delete, insert, or rate endpoint. force-ssl is used
only to read comments and replies (commentThreads.list, comments.list) on videos the
owner selected, to classify sentiment and topic with our own model. Comment text is
purged 30 days after collection; metadata refreshes at every check. Users revoke access
in-app or at myaccount.google.com/permissions, stopping all reads immediately. No data is
sold, shared, or aggregated across channels.
```
(990 of 1000 characters.) The longer version below is the fuller record, kept for
`docs/youtube-quota-extension.md`-style reference and for any follow-up email — not what
was pasted into the form's box.

```
This is a read-only, single-purpose audience-monitoring application for YouTube channel
owners. A signed-in channel owner authorizes the application once, through this OAuth
flow, to read their own channel's video list and the comments and replies on the videos
they choose to monitor. We classify each comment's sentiment (with our own model, run on
our own server — no third party) and topic, and show the owner trends over time,
comparisons between videos, and the underlying comments.

youtube.readonly alone is refused by commentThreads.list on the owner's own videos with
insufficientPermissions — verified against the live API, not assumed. Google offers no
scope narrower than youtube.force-ssl that permits reading comments as the channel owner,
so force-ssl is requested although the application never calls a write, update, delete,
insert, or rate endpoint. We call exactly five read endpoints: channels.list (mine=true,
once, to identify the token's own channel), playlistItems.list and videos.list (catalogue
and, at every scheduled check, only videos.list(part=statistics) to detect which videos'
comment counts moved before reading any comments), commentThreads.list and comments.list
(comments and replies, only on videos the owner selected, and only when their comment
count changed since the last read).

Data retention: comment text is purged automatically 30 days after collection; video and
comment metadata (ids, dates, counts) is refreshed at every scheduled check; our own
sentiment/topic labels are kept for the owner's history and are always shown as ours, not
as YouTube's. A user can withdraw access at any time — inside the application (a
two-step "disconnect channel" control) or at https://myaccount.google.com/permissions —
and either path stops all further reads immediately. Deletion of a user's data on request
is completed within 7 days. No data is sold, shared with other users, or aggregated across
channels; row-level security isolates each customer's data in our database.
```

**Where in your app is this scope used? (screens to show in the video)**
```
1. Why a narrower scope is not enough: commentThreads.list on one of my own videos,
   authorized with youtube.readonly only, returns 403 insufficientPermissions; the same
   call under youtube.force-ssl returns the comments (OAuth Playground / API Explorer).
2. The account page (/account), pressing "Connect a YouTube channel" — where the OAuth
   flow starts, with the app's own notice of what happens at Google.
3. Google's consent screen granting the single scope, youtube.force-ssl.
4. The application's own confirmation that the channel connected.
5. The video catalogue (/sync), populated with channels.list, playlistItems.list and
   videos.list under youtube.force-ssl — no comment read yet; the owner selects videos.
6. The dashboard's comments view, populated with commentThreads.list and comments.list on
   the selected videos — the reason the scope is needed; labels are ours, nothing is
   written back.
7. Revocation, both ways: the "Disconnect channel" control on /account, and the app's
   entry on myaccount.google.com/permissions.
```
(Revised 2026-09-18 for the single scope and the reviewer's "why not narrower" criterion;
the 2026-09-16 wording listed both scopes and had no failing-scope shot.)

**Privacy Policy URL:** `https://app.sky-develop.net/privacy-policy`
**App homepage:** `https://app.sky-develop.net`
**Authorized domain:** `sky-develop.net`

## 2. The demo video — script

Google requires an **unlisted YouTube video**, screen-recorded, 2–3 minutes, showing the
OAuth consent screen and the requested scope actually being used. Record this yourself —
it needs your real Google sign-in and cannot be produced from this session. A tight script,
matching what the reviewer's checklist looks for at each second:

| Time | Screen | Say / show |
| --- | --- | --- |
| 0:00–0:15 | `/account`, signed in | "This is Audience Sentiment, an Arabic-first YouTube comment analysis tool. I'll connect my own channel." Point at the workspace card. |
| 0:15–0:25 | Press "Connect a YouTube channel" | The new confirmation panel appears (`connectAboutGoogle`) — let it show for a couple of seconds; it is part of what a reviewer wants to see: the app *telling the user* what's next before redirecting. |
| 0:25–0:35 | Press "Continue to Google" | Google's account chooser; pick the account. |
| 0:35–0:55 | Consent screen | Let the scope list render fully — `youtube.readonly` and `youtube.force-ssl` both visible. Say: "The app requests read access to my channel and comments — it never writes anything." Click Continue/Allow. |
| 0:55–1:10 | `/connected` | The success screen. "The channel is now connected." |
| 1:10–1:40 | `/sync` (catalogue) | Scroll the video list with reported comment counts. "This is populated by videos.list, under the readonly scope — no comments read yet, just the list and their counts." |
| 1:40–2:20 | `/dashboard` → comments tab | Show the comments with sentiment labels. "This is the actual use of the sensitive scope — reading the comments and replies on the videos I selected, and classifying them. Nothing is written back to YouTube." |
| 2:20–2:40 | `/account` again | Point at "Disconnect channel", click it once to show the confirmation text (do not confirm, to keep the channel connected for further testing). "A user can revoke access from inside the app at any time, in addition to Google's own account settings." |
| 2:40–end | — | "That's the complete scope of what this application does with YouTube data." |

Upload as **unlisted** (not private — Google's reviewer must be able to open the link
without signing in as you), and paste that link into the verification form.

**Recorded, 2026-09-16:** https://youtu.be/tqQV--DhFU0 (2:00, Unlisted). Two earlier
attempts (`youtu.be/wruKZHTg26I`, 47s; `youtu.be/3z25LhO0eWA`, 28s) were preliminary tests,
too short to cover the script, and are not this video. Spot-checked via YouTube's own
scrub-thumbnail previews (no audio check possible from this session): 0:29 shows the
app itself, 1:30 shows Google's real consent screen ("…supabase.co wants access to your
Google Account"), 1:50 shows the `/sync` catalogue — the three screens a reviewer checks
first. Narration content was not verified; the owner reviewed it with sound before
approving.

## 3. What happens after submission

- Google typically responds in days to a few weeks; may ask follow-up questions by email
  to the developer contact on the OAuth consent screen (`engmlubbad@gmail.com`).
- Until approved, the warning in `docs/oauth-connect-flow.md` §4 keeps appearing — this is
  expected, not a sign the submission failed.
- Once approved: the "Google hasn't verified this app" screen stops appearing, and the
  consent screen shows "Audience Sentiment wants access…" instead of the Supabase domain,
  with no further code or configuration change needed.

## 2b. On recording against a live app

Google's own Data Access page warns: "If your app is already public, do not deploy
unverified scopes to your production traffic" and suggests a staging environment or a
separate test project instead. That warning is for a scope not yet shipped. Here,
`youtube.force-ssl` has been live in production since the connection flow was built —
there is no unshipped version to isolate. The same page states the fallback explicitly:
record against the real app, and the "Google hasn't verified this app" screen "is
expected and must be shown in the video" — exactly what §2's script already does.

## 3b. Confirmed live, 2026-09-16

- Branding: App name "SentimentAnalysis" set; logo uploaded (the four-bar mark,
  `docs/oauth-verification-assets/audience-sentiment-logo.png`); homepage, privacy
  policy and terms of service links set to `app.sky-develop.net`; `sky-develop.net`
  added to Authorized domains.
- Domain ownership: `sky-develop.net` verified in Google Search Console as a Domain
  property, under the same Google account.
- Data Access: `youtube.readonly` and `youtube.force-ssl` declared under "Your sensitive
  scopes"; the 990-character justification (§1) pasted into "How will the scopes be
  used?".
- Demo video: recorded and uploaded (§2) — https://youtu.be/tqQV--DhFU0.

## 4. Status

**Ready to submit.** Branding, domain ownership, the scope declaration, the justification
text and the demo video are all done. What's left is pasting the video link into the
Data Access page's "Demo video" field and pressing Save — the owner's own action, since
it is a live edit on the Google Auth Platform console.

## 5. 2026-09-18 — Google's two objections, and the answer

The thread "[Action Needed] OAuth Verification Request Acknowledgement" (from
`api-oauth-dev-verification-reply+2ct39wymk54541d@google.com`, project `272573239614`,
Project ID `gen-lang-client-0819726570`) carried two messages:

1. **2026-09-14 02:50** — the homepage and privacy-policy URLs required sign-in, and the
   privacy policy must fully document how the app interacts with Google user data. Both
   were already fixed by the time the message was read: the Basic-Auth password came off
   the host on 2026-09-16 (`docs/verification.md`, "the password removed, probed from
   outside"; re-probed 2026-09-17: `/`, `/privacy-policy`, `/terms` all `200` with no
   credentials), and the privacy policy's "Google and YouTube data" section names the
   scope, the Limited Use commitment under the Google API Services User Data Policy, the
   thirty-day purge and the revocation page. The message was not answered until now.
2. **2026-09-17 22:59** — the demo video (`youtu.be/tqQV--DhFU0`) "does not sufficiently
   demonstrate why the following scope(s) are necessary or why narrower permissions cannot
   be used", for both `youtube.readonly` and `youtube.force-ssl`. Action required: a new
   video showing the full operational functionality of every requested scope, then a reply
   on the thread.

### 5a. The scope change: one scope instead of two

`youtube.force-ssl` is a superset of `youtube.readonly` — every read the app makes under
readonly (`channels.list`, `playlistItems.list`, `videos.list`) is permitted under
force-ssl. Requesting both was redundant, and redundancy is exactly what a least-privilege
reviewer flags: two scopes to justify where one capability exists. On 2026-09-18
`oauth-start` requests `force-ssl` alone (`supabase/functions/oauth-start/index.ts`); the
privacy policy (ar/en) now says "exactly one permission"; `legal.test.ts` asserts readonly
is absent; the oauth unit tests' fixtures follow.

Three owner-side actions this needs, none of which this checkout can do:
- **Deploy** `oauth-start` so the live consent screen asks for one scope.
- **Google Auth Platform → Data Access**: remove `youtube.readonly` from "Your sensitive
  scopes", keep `youtube.force-ssl`, re-paste the justification (§5b), paste the new
  video link, Save.
- Existing connections keep working: a token granted `readonly + force-ssl` still carries
  force-ssl; nothing re-prompts.

### 5b. Justification text for the single scope (fits the 1000-character box)

```
Audience Sentiment is a read-only YouTube audience-monitoring tool for channel owners. A
signed-in owner authorizes their own channel once via this OAuth flow. We request one
scope, youtube.force-ssl, and use it only to read: channels.list (mine=true) to identify
the owner's channel, playlistItems.list and videos.list to list their videos so they can
choose which to monitor, and commentThreads.list and comments.list to read comments and
replies on the videos they selected, which our own model classifies by sentiment and
topic. Why not youtube.readonly: commentThreads.list on the owner's own videos is refused
under youtube.readonly with insufficientPermissions (shown live in the demo video), and
Google offers no narrower scope that permits reading a channel's comments as its owner.
The app never calls a write, update, delete, insert or rate endpoint. Comment text is
purged 30 days after collection. Users revoke in-app or at
myaccount.google.com/permissions and all reads stop at once. No data is sold, shared or
aggregated across channels.
```

### 5c. The second demo video — script written against the reviewer's checklist

The reviewer's criteria, verbatim: "demonstrate the full operational functionality of
every requested scope" and "why narrower permissions cannot be used". The first video
showed the app working; it did not show the *narrower scope failing*. That is the
missing shot, and it is the centre of this script. Record in one take, unlisted, with
narration; 3–4 minutes; browser address bar visible throughout.

| Time | Screen | Say / show |
| --- | --- | --- |
| 0:00–0:20 | `app.sky-develop.net/` (signed out) | "Audience Sentiment — an Arabic-first YouTube comment-analysis tool for channel owners. Everything it does with YouTube data is read." Scroll to the footer: Privacy Policy and Terms links, open the privacy policy, scroll to **Google and YouTube data**, pause 3 s on the paragraph naming `youtube.force-ssl`. |
| 0:20–0:50 | **Google OAuth Playground** (`developers.google.com/oauthplayground`), or the API Explorer on the `commentThreads.list` reference page | "First, why the narrower scope is not enough." Authorize with **`youtube.readonly` only**, call `youtube.commentThreads.list?part=snippet&videoId=<one of your own videos>`. Show the **403 `insufficientPermissions`** response in full. "Under readonly, YouTube refuses to return the comments on my own video." |
| 0:50–1:05 | Same tool | Re-authorize with **`youtube.force-ssl` only**, repeat the identical call: **200** with comment threads. "The same call succeeds under force-ssl. Google offers nothing in between — this is the narrowest scope that reads a channel's comments as its owner." |
| 1:05–1:20 | `/account`, signed in | "Now the app itself." Press **Connect a YouTube channel** — the confirmation panel that tells the user what happens at Google. |
| 1:20–1:45 | Google consent screen | Let it render fully; the scope list shows **one** entry. "The app asks for one permission. The unverified-app warning is expected until this review completes." Allow. |
| 1:45–2:00 | `/connected` | "Connected." |
| 2:00–2:30 | `/sync` (catalogue) | Scroll the video list with comment counts. "channels.list identified my channel; playlistItems.list and videos.list built this list. No comment has been read yet — I choose which videos to monitor." Select two or three. |
| 2:30–3:10 | `/dashboard` → comments | Show comments with sentiment/topic labels, filter by video, open one comment. "commentThreads.list and comments.list read the comments and replies on the videos I selected; our model labels them. This is the whole use of the scope. Nothing is ever written back — no replies, no deletions, no ratings." |
| 3:10–3:30 | `/account` → **Disconnect channel** | Click, show the confirmation text, confirm. "Revocation from inside the app: collection stops at once and the token is discarded." |
| 3:30–3:50 | `myaccount.google.com/permissions` | Show the app in the list, open it, show the **Remove access** button (press it if the channel was disconnected in the previous step anyway). "And from Google's side." |
| 3:50–end | — | "That is every operation this application performs with the youtube.force-ssl scope: five read calls, no writes, thirty-day retention, revocable at either end." |

Two practical notes. The Playground step needs your own OAuth client's id/secret
(Playground → gear → "Use your own OAuth credentials") so the consent screen shows *this*
app; if you would rather not, the API Explorer on the `commentThreads.list` docs page also
lets you pick scopes per request and shows the raw 403. Record **after** deploying the
one-scope `oauth-start`, otherwise the consent screen at 1:20 still lists two scopes.

### 5d. The reply, one message covering both of theirs

Reply on the same thread (subject unchanged) once the video is uploaded and the Data
Access page saved. `<VIDEO>` is the new unlisted link.

```
Hello,

Thank you for the review. Both messages on this thread are addressed:

1. Homepage and privacy policy (your message of 14 September)
   - Homepage: https://app.sky-develop.net/
   - Privacy policy: https://app.sky-develop.net/privacy-policy
   - Terms of service: https://app.sky-develop.net/terms
   The sign-in requirement has been removed; all three open without authentication.
   The privacy policy's section "Google and YouTube data" documents the Google user
   data the application accesses (the channel, its video list, and the comments on
   videos the owner selects), the scope used, how the data is used and stored, the
   30-day deletion of comment text, that it is not sold, shared or used for
   advertising, our adherence to the Google API Services User Data Policy including
   the Limited Use requirements, and how users revoke access.

2. Scopes and demo video (your message of 17 September)
   - We have reduced the request to a single scope: https://www.googleapis.com/auth/youtube.force-ssl.
     youtube.readonly has been removed from the OAuth client and from the Data Access
     configuration, since force-ssl already covers the read calls it was used for.
   - Why force-ssl and not a narrower scope: commentThreads.list on the owner's own
     videos returns 403 insufficientPermissions under youtube.readonly, and no narrower
     scope permits reading a channel's comments as its owner. The new video shows this
     refusal live, then the same call succeeding under force-ssl.
   - The application only reads: channels.list, playlistItems.list, videos.list,
     commentThreads.list, comments.list. It never calls a write, update, delete,
     insert or rate endpoint.
   - New demonstration video (unlisted): <VIDEO>
     It shows the narrower scope failing, the consent screen with the single scope,
     every in-app feature that uses the scope, and revocation both inside the app and
     from the Google Account permissions page.

The Data Access configuration in the Cloud Console has been updated and saved accordingly.
Please let me know if anything further is needed.

Best regards,
Mohammed Lubbad
```

### 5e. Status

Code and policy done and tested (`legal.test.ts`, `oauth_start.test.ts`,
`oauth_callback.test.ts` green; prettier clean). Waiting on the owner: deploy
`oauth-start`, edit Data Access, record the video per §5c, send §5d.
