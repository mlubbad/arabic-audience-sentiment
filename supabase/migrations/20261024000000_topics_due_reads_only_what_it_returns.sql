-- The topics batch reads the 200 comments it hands out, not the whole channel.
--
-- `private.worker_topics_due` returns at most 200 comments, but it built them
-- by reading every comment of the channel in full (text, parent text, the
-- usage lookup), counting a running total over all of them, and only then
-- keeping the first 200. On the largest channel (4,583 videos, 155,308
-- comments, 125,600 of them unclassified) the comment read alone took 14 of
-- 15.8 s (`explain (analyze, buffers)`, owner's SQL editor, 2026-10-13:
-- `comments_video_date` 4,583 loops, 20,907 pages read from disk), so every
-- call hit the 8 s statement timeout, `control_plane_error:57014` on both
-- workers, nothing was classified and the backlog never shrank.
--
-- 1. `comments_topic_scan`: the columns the selection needs, carried in the
--    index, so finding the next due comments reads the index and not the
--    comments' text. (CONCURRENTLY cannot run inside the deployment
--    transaction; the build takes a share lock on comments for its duration.)
-- 2. worker_topics_due, rebuilt from 20261001010000 with one change: the due
--    comments are walked in the same order (published_at nulls last, id) and
--    the walk stops at max_rows; the text, the parent text and the batch are
--    read for those rows only. The quota rule is the same: with no quota left
--    nothing is returned; with a quota at least max_rows every due row in the
--    first max_rows is affordable, so no usage lookup is needed; with a
--    smaller quota each walked row is checked in order, and a row is taken
--    when it costs nothing (already charged, or purged) or the running count
--    of costing rows is still within the quota, exactly as the window did.
-- 3. svc_worker_topics_due gets its own 25 s statement timeout, as the tick did
--    in 20261023000000, inside the worker's 30 s HTTP timeout.

create index if not exists comments_topic_scan on public.comments
  (workspace_id, video_id, published_at, id)
  include (content_hash, author_channel_id, external_comment_id, content_purged_at);

create or replace function private.worker_topics_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows integer)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  w uuid; c uuid; p text; ext text; kind text; k text; active text; rows jsonb; taxonomy jsonb;
  remaining bigint; sub_open boolean; cap int; spent bigint := 0; costs boolean;
  picked uuid[] := '{}'; cand record;
begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  select platform, external_channel_id into p, ext from public.channels where id = c and workspace_id = w;
  p := coalesce(p, 'youtube');
  if model_id !~ '^[A-Za-z0-9._-]{1,80}$' or prompt_version !~ '^[A-Za-z0-9._-]{1,20}$' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  k := private.topic_classification_key(w, model_id, prompt_version);
  select active_topic_key into active from public.workspaces where id = w;
  if active is not null and active <> k then
    return jsonb_build_object('classification_key', k, 'active', false,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', tp.key, 'description', tp.description)
                            order by tp.position), '[]'::jsonb)
    into taxonomy
    from public.workspace_topics tp where tp.workspace_id = w and tp.retired_at is null;

  select private.subscription_open(s) into sub_open
    from public.subscriptions s
   where s.workspace_id = private.billing_root(w);
  sub_open := coalesce(sub_open, false);

  if sub_open then
    remaining := private.topic_units_remaining(w);
  else
    remaining := 0::bigint;
  end if;

  cap := least(greatest(coalesce(max_rows, 200), 1), 200);

  -- The channel row must exist for any comment to be due (it was a join).
  if sub_open and exists (select 1 from public.channels where id = c and workspace_id = w) then
    for cand in
      select cm.id, cm.external_comment_id, cm.content_purged_at
        from public.videos v
        join public.comments cm on cm.workspace_id = w and cm.video_id = v.id
       where v.workspace_id = w and v.channel_id = c
         and (cm.author_channel_id is null or cm.author_channel_id <> ext)
         and not exists (
           select 1 from public.topic_predictions tp
            where tp.workspace_id = w and tp.comment_id = cm.id
              and tp.content_hash = cm.content_hash and tp.classification_key = k
              and tp.status in ('succeeded','skipped','unsupported'))
       order by cm.published_at nulls last, cm.id
    loop
      if remaining is null or remaining >= cap then
        picked := picked || cand.id;
      else
        costs := cand.content_purged_at is null and not exists (
          select 1 from public.usage_events u
           where u.workspace_id = w
             and u.event_type = 'topic_classification'
             and (u.event_key = 'topics:' || p || ':' || cand.external_comment_id
                  or (p = 'youtube' and u.event_key = 'topics:youtube:' || cand.external_comment_id)));
        if costs then spent := spent + 1; end if;
        if not costs or spent <= remaining then picked := picked || cand.id; end if;
      end if;
      exit when cardinality(picked) >= cap;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'external_comment_id', cm.external_comment_id, 'content_hash', cm.content_hash,
           'text', case when cm.content_purged_at is null then cm.text_raw end,
           'parent_text', case when parent.content_purged_at is null then parent.text_raw end,
           'is_reply', cm.is_reply)
           order by cm.published_at nulls last, cm.id), '[]'::jsonb)
    into rows
    from unnest(picked) as x(id)
    join public.comments cm on cm.workspace_id = w and cm.id = x.id
    left join public.comments parent on parent.workspace_id = w
      and parent.platform = cm.platform and parent.external_comment_id = cm.external_parent_id;

  if jsonb_array_length(rows) = 0 and (not sub_open or (remaining is not null and remaining = 0))
     and private.topics_pending(w, c) then
    return jsonb_build_object('classification_key', k, 'active', true,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'blocked', 'quota_exceeded');
  end if;
  return jsonb_build_object('classification_key', k, 'active', true,
                            'taxonomy', taxonomy, 'rows', rows);
end $function$;

alter function public.svc_worker_topics_due(text, uuid, uuid, text, text, integer)
  set statement_timeout = '25s';
