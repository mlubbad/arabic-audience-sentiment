-- A batch could be charged for analyses it never stored.
--
-- reserve_usage meters from the prediction list. The prediction insert then
-- joins those rows to public.comments, and a prediction naming a comment the
-- batch never delivered simply found no match and was dropped. The charge had
-- already happened. Confirmed by probe: a batch of one comment and two
-- predictions stored one prediction and wrote two usage_events, the second for
-- a comment that does not exist. The call returned success.
--
-- The contract has said so since I1 — "every prediction must belong to a
-- comment in the same batch" — but the edge handler never parses against the
-- contract, so the rule existed only in the client that could ignore it. It
-- now exists where it is enforceable.
--
-- Refused whole, not filtered. Dropping the orphans quietly is what produced
-- the charge; a batch whose predictions do not describe its own rows is a
-- worker defect, and the worker should hear about it rather than pay for it.
--
-- The same pass adds the duplicate-comment rule the contract also states. That
-- one has no billing consequence — ON CONFLICT DO UPDATE already refuses to
-- touch a row twice — but it arrived as a raw 21000 the handler reports as an
-- unrecognised 500. A malformed batch is a 400, and the worker distinguishes
-- them.

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

  -- Both checked before the first write, so a malformed batch costs nothing:
  -- no rows, no receipt, and above all no units.
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

    insert into public.analysis_runs(workspace_id,model_id,revision_sha,preprocessing_version,status)
    select distinct w, p->>'model_id', p->>'revision', p->>'preprocessing_version', 'succeeded'
    from jsonb_array_elements(payload->'predictions') p
    on conflict (workspace_id,model_id,revision_sha,preprocessing_version,parameters) do nothing;

    insert into public.sentiment_predictions(
      workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
    select w, cm.id, p.content_hash, r.id, p.analysis_key, p.status, p.label, p.class_scores
    from jsonb_to_recordset(payload->'predictions') as p(
      external_comment_id text, content_hash text, analysis_key text, status text,
      label text, class_scores jsonb, model_id text, revision text, preprocessing_version text)
    join public.comments cm on cm.workspace_id=w and cm.platform='youtube'
      and cm.external_comment_id=p.external_comment_id
    join public.analysis_runs r on r.workspace_id=w and r.model_id=p.model_id
      and r.revision_sha=p.revision and r.preprocessing_version=p.preprocessing_version
    on conflict (workspace_id,comment_id,content_hash,analysis_key) do nothing;
  end if;

  insert into private.job_batches(job_id,batch_key,checkpoint,payload_hash,outcome)
  values (j, b, coalesce(payload->'checkpoint','{}'::jsonb), hash, outcome);
  update public.jobs set checkpoint=coalesce(payload->'checkpoint','{}'::jsonb) where id=j;
  return jsonb_build_object('replayed', false, 'comments', inserted, 'video_id', vid);
end $$;
