# 0003. Hashed audience identities, kept 30 days, shown only above thresholds
Status: proposed
Date: 2026-10-19

## Context
- Phase 3 of the roadmap (`docs/roadmap/2026-10-17-audience-overlap-and-competitors.md` §3, §6)
  measures audience overlap: how many distinct commenters of channel A also comment on channel B.
  That requires a stable identity per commenter across channels. Today the only one is
  `comments.author_channel_id`, which is personal data of someone who is not the customer.
- `private.purge_comment_text` nulls `author_channel_id`, `author_name` and the text 30 days after
  a comment was last seen. Whatever overlap keeps must not outlive that cycle by the back door.
- YouTube's base Developer Policies forbid "estimating audience affinities". The Derived Metrics
  amendment may allow it, but its examples don't name it. The application guide
  (`docs/2026-10-18-youtube-derived-metrics-application.md`, paragraph C) leaves it to the owner
  whether to declare overlap. No reply has been received.
- `commit_batch` is the hottest write path. On 2026-10-18 it was already hitting the 8 s
  `statement_timeout` before #173 moved per-video recounts out of it. Overlap must not add work
  there.
- YouTube channel ids are public and guessable, so a plain SHA-256 of an id can be reversed with a
  dictionary of known channels.

## Decision
1. **Identity.** `member_hash = HMAC-SHA256(pepper, platform || ':' || author_id)`, stored as
   `bytea`.
   - The pepper is a Supabase Vault secret. It never enters a tracked file, an environment file
     the web app reads (`VITE_*`), the worker or a log.
   - Only `SECURITY DEFINER` functions in `private` read it.
   - Identities are per platform. There is no overlap across platforms, and the UI says so.
2. **Where identities are built.** A separate drain, `private.drain_audience_members()`, runs
   every 10 minutes from pg_cron.
   - It works the way `channel_compare` and #173's stats drain do: a watermark, an advisory lock,
     a time budget, and `SET LOCAL statement_timeout` inside the cron command.
   - It reads comments whose `author_channel_id` is not yet purged and upserts
     `private.audience_members` and `private.audience_member_videos`.
   - `commit_batch` is not changed.
3. **Retention.** Hashed identities follow the comment cycle exactly.
   - A new migration extends `purge_comment_text` to delete `audience_members` and
     `audience_member_videos` rows not seen for 30 days, in the same transaction, so there is one
     rule, not two.
   - Before YouTube accepts a use case that covers overlap, the aggregates (overlap cells and their
     history) also live 30 days.
   - After acceptance, and only for what was accepted, the monthly aggregates (counts and ratios,
     never hashes) may be kept up to 36 months, labeled as our derived metric.
4. **Exclusions.** These are never counted:
   - the channel's own owner;
   - null identities (an unknown commenter is unknown, not a person: invariant "unknown is not
     zero");
   - identities flagged by the first bot rule.

   The bot rule is measured on a labeled sample before it is switched on (task A-5).
5. **What is shown.**
   - An overlap figure appears only when `|A| ≥ 100` and `|A∩B| ≥ 10`. Below that the UI says
     "not enough data", never 0.
   - Every ratio carries a Wilson interval.
   - The UI never shows or exports individual commenters, hashes or a per-person list.
   - RPCs return aggregates only, check membership in SQL, and are tested by calling them as a
     member of another workspace.
6. **Universe.** Overlap is computed inside one workspace, between the channels it already
   collects (option A of §3.3). Any shared, cross-tenant universe needs ADR-0004.
7. **Policy gate.**
   - A-1 and A-2 ship behind a platform switch, `private.platform_switches('audience_overlap')`,
     on WO-22's pattern. It stays off until YouTube accepts a use case that names overlap.
   - If the owner's application did not declare it (paragraph C), a follow-up request comes before
     the switch is turned on.
8. **Pepper rotation.**
   - Rotating the pepper invalidates every hash, so rotation means: new secret, truncate both
     member tables, and let the drain rebuild them from the comments still inside the 30-day
     window.
   - Overlap figures dip for at most one window. Rotation is manual and logged in `audit_events`.

## Consequences
- **Easier:**
  - Overlap needs no change to the worker or to `commit_batch`.
  - Retention stays a single rule, already audited daily.
  - A leaked database dump exposes hashes that can't be reversed without the Vault secret.
- **Harder:**
  - Overlap is only as fresh as the drain (about 10 minutes) and only as complete as collection.
    Partial collection is labeled partial (invariant 2).
  - A commenter first seen more than 30 days ago and not since is gone. That is the point, but
    windows can't be stretched later for existing data.
  - Rotating the pepper costs one window of history.
- **Watch:**
  - the drain's backlog (unprocessed comments older than one run);
  - `audience_members` size per workspace;
  - the share of workspaces under the 100-member threshold (if most are, the feature shows
    "not enough data" and needs a different presentation, not lower thresholds);
  - the bot rule's precision on the labeled sample before it is switched on.
- **Owner decisions this ADR depends on:**
  - whether the Derived Metrics application declared overlap (paragraph C);
  - accepting this ADR by merging it.
