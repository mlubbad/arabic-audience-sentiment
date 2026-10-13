-- The background recounts plan the same way whatever the statistics say.
--
-- After 20261025000000 went live (2026-10-13), the comparison recount
-- finished channel after channel but two kept failing with
-- "canceling statement due to statement timeout" at the 2-minute cron limit:
-- "shfa" (1,415 videos, 25,849 comments) and a second channel of 58,933
-- comments. Both are small; locally a channel of 155,822 comments counts in
-- about half a second.
--
-- Cause, from the owner's read-only EXPLAIN in production: the planner
-- estimated 1 row for `comments where workspace_id = <that workspace>`, 1 for
-- its predictions, and treated its reviews as an empty table. A workspace whose rows arrived after
-- the table's last ANALYZE is not in its statistics, and the estimate for it
-- can fall to one row. With one outer row the planner chose nested loops, and
-- the predictions lookup used only `workspace_id` as its index condition, so
-- every comment scanned all of the workspace's predictions: about
-- 26,000 x 26,000 rows compared. Autoanalyze waits for 10 % of a table to
-- change (about 150,000 rows of `comments` in production), so a newly
-- imported workspace can stay misestimated for days.
--
-- Reproduced locally (PostgreSQL 16.13): a 25,849-comment workspace copied
-- in after ANALYZE.
--   recount of its channel:   cancelled at 150 s; 1.03 s with nested loops
--                             off; 0.16 s after ANALYZE.
--   nightly stats reconcile:  23.9 s; 0.13 s with nested loops off; 0.21 s
--                             after ANALYZE.
-- With fresh statistics, turning nested loops off costs the largest channel
-- (155,822 comments) about 1.6 s instead of 0.6 s: a bounded time is worth
-- more to a background job than the best case.
--
-- 1. The channel recount and the per-workspace reconcile run with
--    `enable_nestloop = off`, so a stale estimate cannot turn them quadratic.
-- 2. The four tables the worker writes most refresh their statistics after
--    1 % of their rows change instead of 10 %, so new workspaces are counted
--    by the planner within hours rather than days. This is a per-table
--    autovacuum setting; it changes no data.

alter function private.refresh_channel_compare_channel(uuid, uuid)
  set enable_nestloop = off;

alter function private.reconcile_video_comment_stats(uuid)
  set enable_nestloop = off;

alter table public.comments set (autovacuum_analyze_scale_factor = 0.01);
alter table public.sentiment_predictions set (autovacuum_analyze_scale_factor = 0.01);
alter table public.topic_predictions set (autovacuum_analyze_scale_factor = 0.01);
alter table public.videos set (autovacuum_analyze_scale_factor = 0.01);
