-- The worker classifies topics. It is handed the rows that lack a verdict
-- under the key its model produces — with the parent's text for a reply and
-- the taxonomy it must choose from — and commits verdicts idempotently,
-- metered as topic_classification. The tick enqueues one analyse job per
-- channel that has something due.
--
-- Design: docs/superpowers/specs/2026-09-15-topic-classification-design.md

create function private.topic_classification_key(w uuid, model_id text, prompt_version text)
returns text language sql stable security invoker set search_path='' as $$
  select 'topics:v' || ws.topic_taxonomy_version::text || '+' || model_id || '+' || prompt_version
    from public.workspaces ws where ws.id = w
$$;

-- A row is due under a key when its current text has no verdict under that
-- key, or its latest verdict there failed. skipped and unsupported are
-- answers; failed is a promise to try again.
create function private.topic_row_due(w uuid, cm public.comments, k text) returns boolean
language sql stable security invoker set search_path='' as $$
  select not exists (
    select 1 from public.topic_predictions p
     where p.workspace_id = w and p.comment_id = cm.id
       and p.content_hash = cm.content_hash and p.classification_key = k
       and p.status in ('succeeded','skipped','unsupported'))
$$;

-- What the tick asks: is there anything for an analyse job to do on this
-- channel? Under the active key when there is one; before any classification
-- has run, any audience comment with no answered verdict under the
-- workspace's current taxonomy version — a verdict recorded under an earlier
-- version (a taxonomy edit bumps the version and clears the active key) does
-- not count as answered, or a re-edited taxonomy would never be rescheduled.
create function private.topics_pending(w uuid, c uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare active text; ver int; begin
  select active_topic_key, topic_taxonomy_version into active, ver from public.workspaces where id = w;
  return exists (
    select 1 from public.comments cm
      join public.videos v on v.workspace_id = w and v.id = cm.video_id
      join public.channels ch on ch.workspace_id = w and ch.id = v.channel_id
     where cm.workspace_id = w and v.channel_id = c
       and (cm.author_channel_id is null or cm.author_channel_id <> ch.external_channel_id)
       and (case when active is null
                 then not exists (select 1 from public.topic_predictions p
                                   where p.workspace_id = w and p.comment_id = cm.id
                                     and p.content_hash = cm.content_hash
                                     and p.status in ('succeeded','skipped','unsupported')
                                     and p.classification_key like 'topics:v' || ver::text || '+%')
                 else private.topic_row_due(w, cm, active) end));
end $$;

-- What the plan can still pay for this period. No subscription, or one that
-- is not active or outside its period, is nothing to spend — the same three
-- refusals reserve_usage raises at commit, read here before the model is
-- called rather than after it has been paid.
create function private.topic_units_remaining(w uuid) returns int
language plpgsql stable security invoker set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.topic_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = w and s.status = 'active'
     and now() >= s.period_start and now() < s.period_end;
  if not found then return 0; end if;
  return greatest(0, sub.topic_units
                     - private.used_units(w, 'topic_classification', sub.period_start));
end $$;

create function private.worker_topics_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; kind text; k text; active text; rows jsonb; taxonomy jsonb; remaining int; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  if model_id !~ '^[A-Za-z0-9._-]{1,80}$' or prompt_version !~ '^[A-Za-z0-9._-]{1,20}$' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  k := private.topic_classification_key(w, model_id, prompt_version);
  select active_topic_key into active from public.workspaces where id = w;
  -- A worker running a model that is not the workspace's active one would
  -- store verdicts that never become effective and pay Gemini for each. It is
  -- told so instead, and reports the job blocked.
  if active is not null and active <> k then
    return jsonb_build_object('classification_key', k, 'active', false,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', tp.key, 'description', tp.description)
                            order by tp.position), '[]'::jsonb)
    into taxonomy
    from public.workspace_topics tp where tp.workspace_id = w and tp.retired_at is null;

  -- Gemini is paid per row sent; the plan is charged per comment on its first
  -- success, once ever. So the list carries every due row that costs nothing
  -- — charged in an earlier period or under an earlier taxonomy version, or
  -- purged, which the worker records unsupported without a model call — and
  -- only as many rows that would cost as the allowance still holds, so a row
  -- is never sent to the model only to be refused at commit.
  remaining := private.topic_units_remaining(w);
  select coalesce(jsonb_agg(jsonb_build_object(
           'external_comment_id', e.external_comment_id, 'content_hash', e.content_hash,
           'text', e.text, 'parent_text', e.parent_text, 'is_reply', e.is_reply)
           order by e.published_at nulls last, e.id), '[]'::jsonb)
    into rows
    from (
    select d.* from (
      select r.*,
             count(*) filter (where r.costs)
               over (order by r.published_at nulls last, r.id
                     rows between unbounded preceding and current row) as spent
        from (
          select cm.id, cm.published_at, cm.external_comment_id, cm.content_hash,
                 -- Purged text goes out as null so the worker records unsupported
                 -- rather than sending an empty string to the model.
                 case when cm.content_purged_at is null then cm.text_raw end as text,
                 case when parent.content_purged_at is null then parent.text_raw end as parent_text,
                 cm.is_reply,
                 cm.content_purged_at is null and not exists (
                   select 1 from public.usage_events u
                    where u.workspace_id = w
                      and u.event_key = 'topics:youtube:' || cm.external_comment_id) as costs
            from public.comments cm
            join public.videos v on v.workspace_id = w and v.id = cm.video_id
            join public.channels ch on ch.workspace_id = w and ch.id = v.channel_id
            left join public.comments parent on parent.workspace_id = w
              and parent.platform = cm.platform and parent.external_comment_id = cm.external_parent_id
           where cm.workspace_id = w and v.channel_id = c
             and (cm.author_channel_id is null or cm.author_channel_id <> ch.external_channel_id)
             and private.topic_row_due(w, cm, k)
        ) r
    ) d
   where d.spent <= remaining
   order by d.published_at nulls last, d.id
   limit least(greatest(coalesce(max_rows, 200), 1), 200)
    ) e;
  -- Rows to classify and nothing to pay for them: said now, before the model
  -- is called. The tick keeps seeing the work; the block is the plan's.
  if jsonb_array_length(rows) = 0 and remaining = 0 and private.topics_pending(w, c) then
    return jsonb_build_object('classification_key', k, 'active', true,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'blocked', 'quota_exceeded');
  end if;
  return jsonb_build_object('classification_key', k, 'active', true,
                            'taxonomy', taxonomy, 'rows', rows);
end $$;

create function private.worker_commit_topics(token_hash text, j uuid, t uuid, b text, records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  w uuid; kind text; hash text; prior text; keys text[]; covered text[]; wanted int; n int; final int;
begin
  w := private.worker_job(token_hash, j, t);
  select type into kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  if b is null or length(b) not between 1 and 200 then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if records is null or jsonb_typeof(records) <> 'array' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if jsonb_array_length(records) > 500 then
    raise exception 'batch_too_large' using errcode='22023'; end if;
  -- Every record well-formed or none written. The key must be the one this
  -- server assigns for the record's own model and prompt: a worker cannot
  -- file a verdict under a key it did not earn.
  if exists (
    select 1 from jsonb_array_elements(records) r
     where jsonb_typeof(r) <> 'object'
        or coalesce(r->>'external_comment_id','') = ''
        or coalesce(r->>'content_hash','') = ''
        or r->>'status' not in ('succeeded','skipped','failed','unsupported')
        or ((r->>'status' = 'succeeded') <> (r->>'topic_key' is not null))
        or (r ? 'confidence' and jsonb_typeof(r->'confidence') not in ('number','null'))
        or coalesce(r->>'model_id','') !~ '^[A-Za-z0-9._-]{1,80}$'
        or coalesce(r->>'prompt_version','') !~ '^[A-Za-z0-9._-]{1,20}$'
        or r->>'classification_key' is distinct from
           private.topic_classification_key(w, r->>'model_id', r->>'prompt_version')) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if (select count(distinct r->>'external_comment_id') from jsonb_array_elements(records) r)
     <> jsonb_array_length(records) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  -- Every named comment is held, and every named topic is live.
  if exists (
    select 1 from jsonb_array_elements(records) r
     where not exists (select 1 from public.comments cm where cm.workspace_id = w
                         and cm.platform = 'youtube' and cm.external_comment_id = r->>'external_comment_id')) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(records) r
     where r->>'topic_key' is not null
       and not exists (select 1 from public.workspace_topics tp where tp.workspace_id = w
                         and tp.key = r->>'topic_key' and tp.retired_at is null)) then
    raise exception 'invalid_batch' using errcode='22023'; end if;

  hash := encode(sha256(convert_to(records::text, 'UTF8')), 'hex');
  select payload_hash into prior from private.job_batches where job_id = j and batch_key = b;
  if found then
    if prior is distinct from hash then raise exception 'batch_conflict' using errcode='23505'; end if;
    return jsonb_build_object('replayed', true, 'stored', 0);
  end if;

  select coalesce(array_agg(distinct 'topics:youtube:' || (r->>'external_comment_id')), '{}')
    into keys from jsonb_array_elements(records) r where r->>'status' = 'succeeded';
  wanted := coalesce(array_length(keys, 1), 0);
  if wanted > 0 then
    covered := private.reserve_usage(w, 'topic_classification', keys);
    if coalesce(array_length(covered, 1), 0) <> wanted then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  with written as (
    insert into public.topic_predictions(
      workspace_id, comment_id, content_hash, classification_key, status, topic_key,
      confidence, model_id, prompt_version, error_code)
    select w, cm.id, r.content_hash, r.classification_key, r.status, r.topic_key,
           r.confidence, r.model_id, r.prompt_version, r.error_code
      from jsonb_to_recordset(records) as r(
        external_comment_id text, content_hash text, classification_key text, status text,
        topic_key text, confidence numeric, model_id text, prompt_version text, error_code text)
      join public.comments cm on cm.workspace_id = w and cm.platform = 'youtube'
       and cm.external_comment_id = r.external_comment_id
    on conflict (workspace_id, comment_id, content_hash, classification_key) do update set
      status = excluded.status, topic_key = excluded.topic_key, confidence = excluded.confidence,
      error_code = excluded.error_code, model_id = excluded.model_id,
      prompt_version = excluded.prompt_version, predicted_at = now()
    -- Only a failure is retried. A final answer (succeeded, skipped, unsupported)
    -- is never overwritten by a later attempt.
    where public.topic_predictions.status = 'failed'
    returning status)
  select count(*)::int, count(*) filter (where status <> 'failed')::int
    into n, final from written;

  insert into private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  values (j, b, '{}'::jsonb, hash, 'partial');
  -- The run's coverage counts verdicts that answered something. A failure is
  -- written so it can be retried, not stored as a topic.
  update public.sync_runs set coverage_summary = coalesce(coverage_summary, '{}'::jsonb)
     || jsonb_build_object('topics_stored',
          coalesce((coverage_summary->>'topics_stored')::int, 0) + final)
   where workspace_id = w and job_id = j;
  return jsonb_build_object('replayed', false, 'stored', n);
end $$;

-- A retry that turns a failed verdict into a success is an update, not an
-- insert, and it may be the workspace's first success: adopt_first_topic_
-- classification (20260916010000) only fires on insert, so an update needs
-- its own trigger to the same effect.
create trigger adopt_first_topic_classification_on_update
  after update on public.topic_predictions
  referencing new table as new_predictions
  for each statement execute function private.adopt_first_topic_classification();

-- schedule_due_work, rebuilt from 20260915132000 with one addition: an
-- analyse job for a channel with unclassified comments.
create or replace function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; a int := 0; cat int; begin
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status = 'connected' loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    if jsonb_array_length(private.due_videos(w, ch.id)) > 0 then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $$;

-- worker_due_videos, rebuilt from 20260915132000 with one change: it refuses
-- a job that is not a collection. A worker built before this migration treats
-- any job that is not discover as a collection; handed an analyse job, it
-- would walk an empty due-video list and mark the job done having classified
-- nothing. The deploy order (worker and edge function before these
-- migrations, workers/deploy/README.md) is the fix; this is the guard, for a
-- gateway that asks the question on such a worker's behalf.
create or replace function private.worker_due_videos(token_hash text, j uuid, t uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; kind text; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'collect' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  return private.due_videos(w, c);
end $$;

create function public.svc_worker_topics_due(
  credential_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_topics_due(credential_hash, j, t, model_id, prompt_version, max_rows) $$;
create function public.svc_worker_commit_topics(credential_hash text, j uuid, t uuid, b text, records jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_commit_topics(credential_hash, j, t, b, records) $$;

revoke all on function
  private.topic_classification_key(uuid,text,text), private.topic_row_due(uuid,public.comments,text),
  private.topics_pending(uuid,uuid), private.topic_units_remaining(uuid),
  private.worker_topics_due(text,uuid,uuid,text,text,int), private.worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_topics_due(text,uuid,uuid,text,text,int), public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function
  private.topic_classification_key(uuid,text,text), private.topic_row_due(uuid,public.comments,text),
  private.topics_pending(uuid,uuid), private.topic_units_remaining(uuid),
  private.worker_topics_due(text,uuid,uuid,text,text,int), private.worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_topics_due(text,uuid,uuid,text,text,int), public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb)
  to service_role;
