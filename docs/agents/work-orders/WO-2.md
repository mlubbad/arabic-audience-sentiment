# #10 WO-2: database security (start after the WO-1 PR is open)

Mirror of GitHub issue #10. **The issue is the source of truth**; this copy exists for agents whose token cannot read issues. If they differ, ask.

```text
Branch codex/wo-2-db-security · PR "WO-2: database security hardening"
Migration timestamp range: 20260929000000 – 20260929235959

OWNED PATHS
- supabase/migrations/ (NEW files only, inside that range)
- new test files in supabase/tests/; edit existing tests only where they assert the old unsafe behaviour (e.g. cross_workspace_deduplication.test.ts), and explain each edit in the PR
- supabase/functions/channel-lookup/** and supabase/functions/_shared/** (only for task 3)

WHERE THE CURRENT CODE IS (the final definition of each function, so you don't need to search)
- private.adopt_channel_content         → 20260924010000_interaction_metrics_and_storytelling.sql:1171 (defined 3x; this is the last)
- private.adopt_channel_catalogue       → same file :954
- private.adopt_video_comments_and_predictions → same file :1015
- private.register_public_channel_impl  → 20260922020000_adopt_full_channel_on_registration_and_backfill.sql:292 (adoption call ~:337)
- public.register_public_channel        → 20260920190000_omnichannel_multi_platform_support.sql:94
- private.has_role                      → 20260921140000_workspace_sharing_and_admin_oversight.sql:12
- public.channel_lookup_reader_grant    → 20260919200000_a_platform_reader_reads_public_channels.sql:111 (grants at :131-132)
- caller in the edge function           → supabase/functions/channel-lookup/index.ts:366
- plan flag: plans.allow_public_channels (added in 20260922160000_plan_public_channels_access.sql)
- has_role is called from 44 migration files. List the current callers with:
  git grep -nE "has_role\(" -- supabase/migrations
  Only the LAST definition of each calling function matters.

DECISION (owner default): a second workspace registering a channel another workspace already has receives ONLY the raw public comments that came from platform collection (not imports), with their public metadata. No predictions, no topics, no taxonomy, no analysis_runs, no sync_runs. Its own worker analyses them, metered normally.

TASKS
1. Rewrite private.adopt_channel_content (and the two helpers) to match the decision.
   - Decide which comments.source / field_provenance values count as "platform collection" and document the choice in the migration.
   - Never copy workspace_topics, active_topic_key, analysis_runs, sync_runs or predictions.
   - An adopted video is NOT marked exhausted/complete unless the donor's own collection for it was complete.
   - Make donor choice deterministic.
2. Enforce plans.allow_public_channels inside register_public_channel_impl, using the existing coded-refusal style. Owner/internal plans keep working.
3. revoke execute on public.channel_lookup_reader_grant() from authenticated; grant it to service_role only. channel-lookup must first check the caller is owner/analyst of the workspace (with the caller's JWT), then read the grant with the service client. Tokens never go into responses or logs.
4. private.has_role: the platform-admin bypass applies ONLY when the requested role set includes 'viewer' (read-only).
   - List every caller in the PR, marked read or write.
   - Any admin feature that relied on the owner bypass either gets an audited admin_* RPC or is listed as intentionally removed.

ACCEPTANCE (each one is a PGlite test that calls the function directly, the way an attacker would, and fails on the old code)
- [ ] Workspace B registering a channel held by workspace A gets none of A's imported comments, topics, taxonomy, runs, sync rows or predictions; it gets only A's platform-collected comments.
- [ ] A Free-plan workspace calling register_public_channel directly is refused; an owner-plan workspace succeeds.
- [ ] An authenticated user calling channel_lookup_reader_grant directly gets a permission error.
- [ ] A platform admin who isn't a member can't run owner/analyst actions (remove_channel, select_videos, the billing checkout RPC) in another tenant, but can still read at viewer level.
- [ ] Every new or replaced SECURITY DEFINER function has search_path='', fully qualified names, and revoke … from public, anon.
- [ ] npm run check, npm run test:e2e and npm run check:functions pass (paste the summary lines).
- [ ] Do NOT run db:migrate:remote or deploy functions.

OUT OF SCOPE: the job retry loop, the unlimited-plan overflow, import, dashboard SQL, OAuth (those are WO-5a/5b); apps/web/; workers/.
```
