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

**Scopes requesting verification:**
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
1. The account page (/account), pressing "Connect a YouTube channel" — this is where the
   OAuth flow in question starts.
2. Google's consent screen granting youtube.readonly and youtube.force-ssl.
3. The application's own confirmation that the channel connected.
4. The video catalogue (/sync), which is populated using videos.list and playlistItems.list
   under youtube.readonly.
5. The dashboard's comments view, populated using commentThreads.list and comments.list
   under youtube.force-ssl — the actual, and only, use of the sensitive scope.
6. The account page again, showing the "disconnect channel" control — the in-app revocation
   path.
```

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

## 4. Status

**In progress.** Branding, domain ownership and the scope declaration are done; the
justification text is drafted (§1) and ready to paste. The one remaining field is the
demo video's YouTube link — needs the owner's own screen recording per §2's script,
uploaded unlisted, then pasted into "Demo video: how will the scopes be used?" before
Save becomes available on the Data Access page.
