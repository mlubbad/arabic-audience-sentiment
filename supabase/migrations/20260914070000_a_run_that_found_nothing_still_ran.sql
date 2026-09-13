-- public.sync_runs was created, indexed and secured, and written by nothing.
-- The operations panel reads it, so after four successful collections it still
-- announced "no sync has run, and no worker is connected" — a confident denial
-- of work that had demonstrably happened, which is worse than saying nothing.
--
-- A run is now opened by the first batch of a job and closed when the job
-- finishes, including when it finishes having collected nothing: a job that
-- found a video with comments disabled did run, and the reason belongs in the
-- record rather than being indistinguishable from never having tried.
--
-- job_id ties the two together. It is nullable because the rows that predate
-- this have no job to point at, and inventing one would be a lie about
-- provenance in the very table added to stop the lying.
alter table public.sync_runs add column job_id uuid;
alter table public.sync_runs add constraint sync_runs_one_per_job
  unique (workspace_id, job_id);
-- The jobs vocabulary includes cancelled; this table's did not, so a cancelled
-- job could not have its run closed and would have been left running for ever.
alter table public.sync_runs drop constraint sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check
  check (status in ('running','succeeded','partial','failed','blocked','cancelled'));

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
  on conflict (workspace_id,platform,external_video_id) do update
    set last_observed_at = now(),
        -- A video keeps the best name anyone has sent for it. The insert above
        -- falls back to the platform id when no title came with the batch, and
        -- that fallback must never overwrite a real title a previous run
        -- stored: only a value that is not the id itself replaces what is
        -- there. Before this the title was frozen at whatever the first batch
        -- happened to carry, so a channel collected once without titles showed
        -- YouTube ids on the dashboard for ever.
        title = case
                  when excluded.title <> public.videos.external_video_id
                    then excluded.title
                  else public.videos.title
                end
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

  -- The run this batch belongs to. Opened on first commit and accumulated on
  -- every one after, so coverage is the sum of what actually landed rather
  -- than a number the worker asserts about itself.
  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source, status)
  values (w, ch, j, 'collect',
          coalesce((select c->>'source'
                      from jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
                     limit 1), 'unknown'),
          'running')
  on conflict (workspace_id, job_id) do nothing;

  update public.sync_runs r set coverage_summary = (
    -- The set of videos this run has touched is accumulated, not inferred.
    -- Nothing else records which video a committed batch was for, and a count
    -- that cannot be recomputed from what is stored is a number nobody can
    -- check.
    with seen as (
      select coalesce(r.coverage_summary->'videos', '[]'::jsonb)
             || jsonb_build_array(vid::text) as v)
    select jsonb_build_object(
      'videos', (select jsonb_agg(distinct e)
                   from seen, jsonb_array_elements_text(seen.v) e),
      'videos_seen', (select count(distinct e)
                        from seen, jsonb_array_elements_text(seen.v) e),
      'comments_collected',
        coalesce((r.coverage_summary->>'comments_collected')::int, 0) + inserted,
      -- Complete means the source was traversed to its end, which only an
      -- exhausted batch can say. Anything else leaves it false.
      'complete', outcome = 'exhausted')
  )
  where r.workspace_id = w and r.job_id = j;

  return jsonb_build_object('replayed', false, 'comments', inserted, 'video_id', vid);
end $$;

-- Closing the run. A job that ended without ever committing a batch still had a
-- run: it is the run that found nothing, and recording it is the difference
-- between "collection has never happened" and "collection happened and there
-- was nothing there". The operations page was reporting the first for every
-- one of these.
create or replace function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; ch uuid; begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  update public.jobs set status = outcome,
    error_code = case when outcome = 'succeeded' then null else reason end,
    -- Releasing the lease is what makes a finished job unwritable.
    lease_token = null, lease_expires_at = null
  where id = j
  returning workspace_id, channel_id into w, ch;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status, ended_at, error_code)
  values (w, ch, j, 'collect', 'unknown', outcome, now(),
          case when outcome = 'succeeded' then null else reason end)
  on conflict (workspace_id, job_id) do update
    set status = excluded.status,
        ended_at = excluded.ended_at,
        error_code = excluded.error_code;
end $$;
