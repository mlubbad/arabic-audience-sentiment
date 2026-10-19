# YouTube API audit: Derived Metrics (Analytics & Reporting) and quota, 2026-10

2026-10-19. Answers to paste into the **YouTube API Services: Audit and Quota Extension Form**
(<https://support.google.com/youtube/contact/yt_api_form>). They replace the September draft in
`docs/youtube-quota-extension.md`, several of whose statements are no longer true (see §4).
**The owner submits**, signed in as the Google account that owns the API project
(engmlubbad@gmail.com). Facts below are from the code on `main` and a read-only production query
on 2026-10-19.

## 1. Form choices

- **Section 1, request type:** "Complete a compliance audit to request for additional quota". The
  audit also carries the Derived Metrics amendment. Quota is now the platform's bottleneck: on
  2026-10-18/19 the daily 10,000 units ran out before the scheduled catalogue refreshes ran.
- **Section 5, use case:** **"Analytics & Reporting"**. This is what accepts the amendment in
  `developers.google.com/youtube/terms/derived-metrics-policy`.

## 2. Answers (in English, as submitted)

**What does your API client do?**
Arabic Audience Sentiment is an Arabic-first analytics service for YouTube creators, marketing
agencies and media companies. For the channels a customer monitors, it reads the public video
list, the public comments on selected videos and the channel's public statistics. It then shows
the customer aggregate analysis:
- comment sentiment (positive, negative, neutral, mixed), from an Arabic model running on our own
  server;
- comment topics;
- trends over time and comparisons between videos and between channels;
- the channel's own subscriber, view and video counts over time.

Nothing is written to YouTube.

**Which channels are read, and with whose authority?**
Two ways, both read-only:
1. **Owner-connected channels** (5 today). The owner grants access through Google's consent
   screen; `channels.list(mine=true)` decides which channel the grant belongs to.
2. **Public channels** (107 today), added by a customer by link or search. They are read through
   the platform's own read access, only for public data any visitor can see: public videos,
   public comments, public channel statistics. No user's token is used for a channel the user
   does not own.

**Endpoints and quota cost:**
- `channels.list`
  - `mine=true` at connection.
  - `part=contentDetails,snippet,statistics,brandingSettings,topicDetails` once per catalogue
    refresh: 1 unit for the uploads playlist, the public profile and the public statistics in
    one call.
- `playlistItems.list` (uploads, Shorts and live tabs). An incremental refresh reads only down to
  the first page of already-known videos.
- `videos.list(part=snippet,statistics,contentDetails)`, 50 videos per unit. Before a scheduled
  read, `part=statistics` skips videos whose comment count has not moved.
- `commentThreads.list` and `comments.list`, for comments and replies on selected videos.
- `channelSections.list`, once a week per channel, for the featured channels the channel itself
  lists, as competitor candidates.
- `search.list(type=channel)`, only when a customer searches for a channel by name (100 units,
  user-initiated); naming a channel by id or handle costs 1.
- No insert, update or delete endpoints.

**Derived metrics we compute (Analytics & Reporting).** All of these are shown as *our* analysis,
labelled as such and never as YouTube data:
1. **Viewer sentiment** (policy §4). Each public comment is labelled positive, negative, neutral
   or mixed, and only aggregates are shown per video, channel and period. We never infer
   protected attributes of viewers or creators: no age, gender, religion, political leaning,
   ethnicity, sexual orientation or health.
2. **Content categorization** (§3). Each channel is classified into our own Arabic genre
   taxonomy, levels Main/Primary/Secondary, with IAB Content Taxonomy 3.1 ids where one matches.
   It is shown as our classification, distinct from YouTube's video categories, which we never
   relabel.
3. **Channel scores and comparisons** (§1, §5). We compute a competitor relevance score from our
   genre similarity, the size ratio of public subscriber counts, posting activity and language or
   market. Comparisons are presented for benchmarking, never as a rivalry, "war" or "battle".
4. **Statistics history** (Data Storage). A daily snapshot of public subscriber, view and video
   counts per monitored channel, used for growth trends and comparisons.

**What data do you store, for how long?**
- Comment text, commenter channel ids and names: **purged after 30 days** (`purge_comment_text`,
  daily).
- Channel description, keywords and topic categories: **cleared 30 days after the last refresh**
  (`purge_channel_profile`, daily).
- Daily public statistics: kept **30 days today**. On acceptance of this amendment we will keep
  them **up to 36 months** as the policy allows. That is a change to the purge job's argument,
  already built for it.
- Our derived labels (sentiment, topic, genre, scores): kept for the customer's history, as
  derived metrics.
- Video metadata is refreshed at every catalogue refresh (every 6–24 hours, depending on plan).
- A workspace and all its data are deleted on request. Data is stored in Supabase Postgres, isolated
  per customer workspace by row-level security.

**Do you aggregate data across users?**
No customer sees another customer's data. Platform operations (scheduling, quota, health) count
across workspaces internally and never expose one customer's data to another.

**Expected traffic and requested quota:**
- **Today:** 112 YouTube channels. A day's scheduled work (catalogue refreshes at about 4 units
  per channel since our incremental refresh, plus comment reads on selected videos) exhausts the
  10,000 default. On 2026-10-18/19 scheduled refreshes were held to the next reset.
- **Requested: 50,000 units/day.** That keeps one day of new large-channel onboardings (~1,900
  units each) from blocking every other customer's scheduled reads until midnight Pacific.

**Compliance statements:**
- We link the YouTube Terms of Service and the Google Privacy Policy from `/terms` and
  `/privacy-policy`.
- We refresh or delete authorized data within 30 days, except the statistics and derived metrics
  this amendment covers.
- We do not sell data.
- We do not present derived metrics as YouTube data, and we do not replace YouTube categories or
  metrics.
- We do not infer protected attributes.

## 3. Before submitting (the owner)

- [x] `/`, `/pricing`, `/privacy-policy` and `/terms` open without a password on
      `app.sky-develop.net`: all answered HTTP 200 on 2026-10-19.
- [ ] **`/privacy-policy` must be updated first.** Checked 2026-10-19
      (`apps/web/src/legal/en.ts:51,79,87` and `ar.ts:57`): it describes only owner-connected
      channels ("after you explicitly authorise it"). It does not cover:
      - public channels read through the platform reader;
      - channel profile text and its 30-day purge;
      - daily statistics and the 36-month retention on acceptance;
      - genre classification as our own categories;
      - no inference of protected attributes.

      A reviewer comparing this form with the policy would see the gap. The fix is roadmap task
      0.5: a Claude PR with the Arabic and English text, approved by the owner.
- [ ] Attach `docs/quota-application/supporting-materials.pdf`, architecture and user-flow
      diagrams. They predate public channels and channel stats, so regenerate them or add a note.

## 4. What changed since the September draft (do not reuse these lines)

- "No data from channels the user does not own is read". **False now:** 107 public channels are
  read through the platform reader (public data only).
- "It does not aggregate data across users' channels". Reworded above: no customer sees another's
  data; operations count across workspaces internally.
- Endpoint list: `channelSections.list`, `search.list` and the wider `channels.list` parts were
  added.
- Retention: channel profile text and daily statistics were added (WO-20, `20261105000000`).
