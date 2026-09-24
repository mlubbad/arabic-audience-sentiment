-- Omnichannel topic classification and usage events cost index.
-- Updates worker_topics_due and worker_commit_topics to support all platforms
-- (youtube, telegram, x, tiktok) and indexes usage_events to eliminate 57014 timeouts.

create index if not exists usage_events_workspace_event_key_idx
  on public.usage_events(workspace_id, event_key);

create index if not exists usage_events_workspace_event_type_key_idx
  on public.usage_events(workspace_id, event_type, event_key);

create or replace function private.worker_topics_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  w uuid; c uuid; p text; kind text; k text; active text; rows jsonb; taxonomy jsonb; remaining int;
begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  select platform into p from public.channels where id = c and workspace_id = w;
  p := coalesce(p, 'youtube');
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
  -- success, once ever.
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
                 case when cm.content_purged_at is null then cm.text_raw end as text,
                 case when parent.content_purged_at is null then parent.text_raw end as parent_text,
                 cm.is_reply,
                 cm.content_purged_at is null and not exists (
                   select 1 from public.usage_events u
                    where u.workspace_id = w
                      and u.event_type = 'topic_classification'
                      and (u.event_key = 'topics:' || p || ':' || cm.external_comment_id
                           or (p = 'youtube' and u.event_key = 'topics:youtube:' || cm.external_comment_id))) as costs
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
    where remaining is not null and (not d.costs or d.spent <= remaining)
    order by d.published_at nulls last, d.id
    limit least(greatest(coalesce(max_rows, 200), 1), 200)
    ) e;

  if jsonb_array_length(rows) = 0 and coalesce(remaining, 0) = 0
     and private.topics_pending(w, c) then
    return jsonb_build_object('classification_key', k, 'active', true,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'blocked', 'quota_exceeded');
  end if;
  return jsonb_build_object('classification_key', k, 'active', true,
                            'taxonomy', taxonomy, 'rows', rows);
end $$;

create or replace function private.worker_commit_topics(token_hash text, j uuid, t uuid, b text, records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  w uuid; c uuid; p text; kind text; hash text; prior text; keys text[]; covered text[]; wanted int; n int; final int;
begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  select platform into p from public.channels where id = c and workspace_id = w;
  p := coalesce(p, 'youtube');
  if b is null or length(b) not between 1 and 200 then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if records is null or jsonb_typeof(records) <> 'array' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if jsonb_array_length(records) > 500 then
    raise exception 'batch_too_large' using errcode='22023'; end if;

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

  -- Every named comment is held for this workspace and channel's platform, and every named topic is live.
  if exists (
    select 1 from jsonb_array_elements(records) r
     where not exists (select 1 from public.comments cm where cm.workspace_id = w
                         and cm.platform = p and cm.external_comment_id = r->>'external_comment_id')) then
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

  select coalesce(array_agg(distinct 'topics:' || p || ':' || (r->>'external_comment_id')), '{}')
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
      join public.comments cm on cm.workspace_id = w and cm.platform = p
       and cm.external_comment_id = r.external_comment_id
    on conflict (workspace_id, comment_id, content_hash, classification_key) do update set
      status = excluded.status, topic_key = excluded.topic_key, confidence = excluded.confidence,
      error_code = excluded.error_code, model_id = excluded.model_id,
      prompt_version = excluded.prompt_version, predicted_at = now()
    where public.topic_predictions.status = 'failed'
    returning status)
  select count(*)::int, count(*) filter (where status <> 'failed')::int
    into n, final from written;

  insert into private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  values (j, b, '{}'::jsonb, hash, 'partial');

  update public.sync_runs set coverage_summary = coalesce(coverage_summary, '{}'::jsonb)
     || jsonb_build_object('topics_stored',
          coalesce((coverage_summary->>'topics_stored')::int, 0) + final)
   where workspace_id = w and job_id = j;
  return jsonb_build_object('replayed', false, 'stored', n);
end $$;

-- Unblock any previously blocked omnichannel analyse jobs
update public.jobs
   set status = 'queued',
       lease_token = null,
       lease_expires_at = null,
       error_code = null
 where type = 'analyse'
   and status = 'blocked'
   and error_code = 'invalid_batch';
