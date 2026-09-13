-- analysis_runs.parameters was never written.
--
-- The column existed with a '{}' default and the run-identity index named it,
-- so every run looked identical in its settings whether or not it was. The
-- worker had settings to report all along — a model card carries max_length —
-- and dropped them on the way.
--
-- An unwritten column in a unique index is worse than one that is absent: the
-- index claims the identity accounts for settings, so a reader trusts a
-- distinction that is not being made.
--
-- The prediction join now matches on parameters too. Without that, a second run
-- differing only in its settings would find the first run's row and file its
-- verdicts under it.

create or replace function private.commit_batch(j uuid, t uuid, b text, hash text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  w uuid; ch uuid; vid uuid; prior text; outcome text;
  keys text[]; covered text[]; wanted int; inserted int;
begin
  select workspace_id, channel_id into w, ch from public.jobs
  where id=j and lease_token=t and status='running' and lease_expires_at>now() for update;
  if not found then raise exception 'lease_lost' using errcode='40001'; end if;
  if b is null or length(b) not between 1 and 200 or hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) > 500
     or jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 500 then
    raise exception 'batch_too_large' using errcode='22023'; end if;
  outcome := payload->>'outcome';
  if outcome not in ('partial','exhausted','blocked','failed') then
    raise exception 'invalid_batch' using errcode='22023'; end if;

  if (select count(distinct c->>'external_comment_id')
      from jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c)
     <> jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(payload->'predictions','[]'::jsonb)) p
    where not exists (
      select 1 from jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
      where c->>'external_comment_id' = p->>'external_comment_id')
  ) then raise exception 'invalid_batch' using errcode='22023'; end if;

  select payload_hash into prior from private.job_batches where job_id=j and batch_key=b;
  if found then
    if prior is distinct from hash then raise exception 'batch_conflict' using errcode='23505'; end if;
    return jsonb_build_object('replayed', true);
  end if;

  insert into public.videos(workspace_id,channel_id,external_video_id,title)
  values (w, ch, payload->>'external_video_id',
          coalesce(nullif(payload->>'video_title',''), payload->>'external_video_id'))
  on conflict (workspace_id,platform,external_video_id) do update set last_observed_at=now()
  returning id into vid;

  insert into public.comments(
    workspace_id,video_id,external_comment_id,external_parent_id,is_reply,parent_source,
    author_channel_id,author_name,text_raw,text_plain,content_hash,published_time_raw,
    published_at,timestamp_precision,likes_raw,likes_value,source,field_provenance)
  select w, vid, c.external_comment_id, c.external_parent_id, c.is_reply, c.parent_source,
         c.author_channel_id, c.author_name, c.text_raw, c.text_plain, c.content_hash,
         c.published_time_raw, c.published_at, c.timestamp_precision, c.likes_raw,
         c.likes_value, c.source, c.field_provenance
  from jsonb_to_recordset(payload->'comments') as c(
    external_comment_id text, external_parent_id text, is_reply boolean, parent_source text,
    author_channel_id text, author_name text, text_raw text, text_plain text, content_hash text,
    published_time_raw text, published_at timestamptz, timestamp_precision text,
    likes_raw text, likes_value bigint, source text, field_provenance jsonb)
  on conflict (workspace_id,platform,external_comment_id) do update set
    text_raw=excluded.text_raw, text_plain=excluded.text_plain,
    content_hash=excluded.content_hash, likes_raw=excluded.likes_raw,
    likes_value=excluded.likes_value, field_provenance=excluded.field_provenance,
    last_seen_at=now();
  get diagnostics inserted = row_count;

  if jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 0 then
    select coalesce(array_agg(distinct 'analysis:youtube:'||(p->>'external_comment_id')),'{}')
    into keys from jsonb_array_elements(payload->'predictions') p
    where p->>'status'='succeeded';
    wanted := coalesce(array_length(keys,1),0);
    if wanted > 0 then
      covered := private.reserve_usage(w,'comment_analysis',keys);
      if coalesce(array_length(covered,1),0) <> wanted then
        raise exception 'quota_exceeded' using errcode='53400'; end if;
    end if;

    -- Settings are stored, so a run's identity is what the index says it is.
    insert into public.analysis_runs(
      workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
    select distinct w, p->>'model_id', p->>'revision', p->>'preprocessing_version',
           coalesce(p->'parameters','{}'::jsonb), 'succeeded'
    from jsonb_array_elements(payload->'predictions') p
    on conflict (workspace_id,model_id,revision_sha,preprocessing_version,parameters) do nothing;

    insert into public.sentiment_predictions(
      workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
    select w, cm.id, p.content_hash, r.id, p.analysis_key, p.status, p.label, p.class_scores
    from jsonb_to_recordset(payload->'predictions') as p(
      external_comment_id text, content_hash text, analysis_key text, status text,
      label text, class_scores jsonb, model_id text, revision text,
      preprocessing_version text, parameters jsonb)
    join public.comments cm on cm.workspace_id=w and cm.platform='youtube'
      and cm.external_comment_id=p.external_comment_id
    join public.analysis_runs r on r.workspace_id=w and r.model_id=p.model_id
      and r.revision_sha=p.revision and r.preprocessing_version=p.preprocessing_version
      and r.parameters=coalesce(p.parameters,'{}'::jsonb)
    on conflict (workspace_id,comment_id,content_hash,analysis_key) do nothing;
  end if;

  insert into private.job_batches(job_id,batch_key,checkpoint,payload_hash,outcome)
  values (j, b, coalesce(payload->'checkpoint','{}'::jsonb), hash, outcome);
  update public.jobs set checkpoint=coalesce(payload->'checkpoint','{}'::jsonb) where id=j;
  return jsonb_build_object('replayed', false, 'comments', inserted, 'video_id', vid);
end $$;
