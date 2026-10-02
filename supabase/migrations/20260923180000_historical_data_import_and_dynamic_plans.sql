-- Migration: 20260923180000_historical_data_import_and_dynamic_plans.sql
-- Goal: Dynamic plan limits control for platform admins, omnichannel historical platform
-- data sync (YouTube & Telegram), and external file import (CSV/JSON) for historical posts & comments,
-- with isolated metering against historical_backfill units.

-- 1. Add historical_days_limit column to public.plans
alter table public.plans
  add column if not exists historical_days_limit integer default 0
  check (historical_days_limit is null or historical_days_limit >= 0);

-- 2. Update default seed values across plan tiers
update public.plans set historical_days_limit = 0,    backfill_units = 0       where key = 'free';
update public.plans set historical_days_limit = 30,   backfill_units = 40000   where key = 'creator';
update public.plans set historical_days_limit = 90,   backfill_units = 120000  where key = 'creator_plus';
update public.plans set historical_days_limit = 365,  backfill_units = 600000  where key = 'agency';
update public.plans set historical_days_limit = 730,  backfill_units = 2000000 where key = 'media';
update public.plans set historical_days_limit = null, backfill_units = 4000000 where key = 'enterprise';
update public.plans set historical_days_limit = null, backfill_units = null    where key = 'owner';

-- 3. Update private.plan_json to include historical_days_limit and backfill_units
create or replace function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'allow_public_channels', coalesce(p.allow_public_channels, false),
    'backfill_units', coalesce(p.backfill_units, -1),
    'historical_days_limit', coalesce(p.historical_days_limit, -1),
    'limits', jsonb_build_object(
      'analysis_units', coalesce(p.analysis_units, -1),
      'topic_units', coalesce(p.topic_units, -1),
      'insight_reports', p.insight_reports,
      'channels', coalesce(p.channels_limit, -1),
      'members', coalesce(p.members_limit, -1),
      'workspaces', coalesce(p.workspaces_limit, -1),
      'live_interval_minutes', p.live_interval_minutes));
$$;

-- 4. Calculate remaining historical backfill units for a workspace
create or replace function private.backfill_remaining(w uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare
  sub record;
begin
  select s.period_start, pl.backfill_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  if sub.backfill_units is null then return 2147483647; end if; -- unlimited
  return greatest(0, sub.backfill_units + private.granted_units(w, 'historical_backfill')
                     - private.used_units(w, 'historical_backfill', sub.period_start));
end $$;
revoke all on function private.backfill_remaining(uuid) from public, anon, authenticated;

-- 5. Admin RPC to dynamically update plan limits
create or replace function public.update_plan_limits(p_plan_key text, p_limits jsonb)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  updated_plan public.plans;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if not exists (select 1 from public.plans where key = p_plan_key) then
    raise exception 'unknown_plan' using errcode='22023';
  end if;

  update public.plans
     set backfill_units = case
           when p_limits ? 'backfill_units' then
             case when (p_limits->>'backfill_units')::int = -1 then null else (p_limits->>'backfill_units')::int end
           else backfill_units end,
         historical_days_limit = case
           when p_limits ? 'historical_days_limit' then
             case when (p_limits->>'historical_days_limit')::int = -1 then null else (p_limits->>'historical_days_limit')::int end
           else historical_days_limit end,
         analysis_units = case
           when p_limits ? 'analysis_units' then
             case when (p_limits->>'analysis_units')::int = -1 then null else (p_limits->>'analysis_units')::int end
           else analysis_units end,
         topic_units = case
           when p_limits ? 'topic_units' then
             case when (p_limits->>'topic_units')::int = -1 then null else (p_limits->>'topic_units')::int end
           else topic_units end,
         channels_limit = case
           when p_limits ? 'channels_limit' then
             case when (p_limits->>'channels_limit')::int = -1 then null else (p_limits->>'channels_limit')::int end
           else channels_limit end,
         allow_public_channels = case
           when p_limits ? 'allow_public_channels' then
             (p_limits->>'allow_public_channels')::boolean
           else allow_public_channels end
   where key = p_plan_key
   returning * into updated_plan;

  return jsonb_build_object(
    'ok', true,
    'plan_key', p_plan_key,
    'plan', private.plan_json(updated_plan)
  );
end $$;
revoke all on function public.update_plan_limits(text, jsonb) from public, anon;
grant execute on function public.update_plan_limits(text, jsonb) to authenticated;

-- 6. Update private.commit_batch to meter historical jobs under historical_backfill
drop function if exists private.commit_batch(uuid, text, text, text, jsonb);
create or replace function private.commit_batch(
  j uuid, t uuid, b text, hash text, payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
DECLARE
  w uuid; ch uuid; vid uuid; prior text; outcome text; ch_platform text;
  j_type text; j_payload jsonb; is_hist boolean;
  keys text[]; covered text[]; wanted int; inserted int;
BEGIN
  SELECT workspace_id, channel_id, type, checkpoint INTO w, ch, j_type, j_payload FROM public.jobs
  WHERE id=j AND lease_token=t AND status='running' AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_lost' USING errcode='40001'; END IF;
  IF b IS NULL OR length(b) NOT BETWEEN 1 AND 200 OR hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;
  IF jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) > 500
     OR jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'batch_too_large' USING errcode='22023'; END IF;
  outcome := payload->>'outcome';
  IF outcome NOT IN ('partial','exhausted','blocked','failed') THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;

  SELECT coalesce(platform, 'youtube') INTO ch_platform FROM public.channels WHERE id=ch;

  IF (SELECT count(DISTINCT c->>'external_comment_id')
      FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c)
     <> jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(payload->'predictions','[]'::jsonb)) p
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
      WHERE c->>'external_comment_id' = p->>'external_comment_id')
  ) THEN RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;

  SELECT payload_hash INTO prior FROM private.job_batches WHERE job_id=j AND batch_key=b;
  IF FOUND THEN
    IF prior IS DISTINCT FROM hash THEN RAISE EXCEPTION 'batch_conflict' USING errcode='23505'; END IF;
    RETURN jsonb_build_object('replayed', true);
  END IF;

  is_hist := (j_type = 'import' OR coalesce(j_payload->>'is_historical', 'false') = 'true' OR coalesce(payload->>'is_historical', 'false') = 'true');

  INSERT INTO public.videos(workspace_id,channel_id,platform,external_video_id,title,kind)
  VALUES (w, ch, ch_platform, payload->>'external_video_id',
          coalesce(nullif(payload->>'video_title',''), payload->>'external_video_id'),
          coalesce(payload->>'video_kind', payload->>'kind', CASE WHEN ch_platform = 'telegram' THEN 'channel_post' WHEN ch_platform = 'x' THEN 'tweet' ELSE 'video' END))
  ON CONFLICT (workspace_id,platform,external_video_id) DO UPDATE
    SET last_observed_at = now(),
        kind = coalesce(excluded.kind, public.videos.kind),
        title = CASE
                  WHEN excluded.title <> public.videos.external_video_id
                    THEN excluded.title
                  ELSE public.videos.title
                END
  RETURNING id INTO vid;

  INSERT INTO public.comments(
    workspace_id,video_id,platform,external_comment_id,external_parent_id,is_reply,parent_source,
    author_channel_id,author_name,text_raw,text_plain,content_hash,published_time_raw,
    published_at,timestamp_precision,likes_raw,likes_value,source,field_provenance)
  SELECT w, vid, ch_platform, c.external_comment_id, c.external_parent_id, c.is_reply, c.parent_source,
         c.author_channel_id, c.author_name, c.text_raw, c.text_plain, c.content_hash,
         c.published_time_raw, c.published_at, c.timestamp_precision, c.likes_raw,
         c.likes_value, c.source, c.field_provenance
  FROM jsonb_to_recordset(payload->'comments') AS c(
    external_comment_id text, external_parent_id text, is_reply boolean, parent_source text,
    author_channel_id text, author_name text, text_raw text, text_plain text, content_hash text,
    published_time_raw text, published_at timestamptz, timestamp_precision text,
    likes_raw text, likes_value bigint, source text, field_provenance jsonb)
  ON CONFLICT (workspace_id,platform,external_comment_id) DO UPDATE SET
    text_raw=excluded.text_raw, text_plain=excluded.text_plain,
    content_hash=excluded.content_hash, likes_raw=excluded.likes_raw,
    likes_value=excluded.likes_value, field_provenance=excluded.field_provenance,
    last_seen_at=now();
  GET DIAGNOSTICS inserted = row_count;

  -- Metering logic: isolated between live comment_analysis and historical_backfill
  IF is_hist THEN
    -- Historical import: meter comment backfill units under historical_backfill
    SELECT coalesce(array_agg(DISTINCT 'backfill:'||ch_platform||':'||(c->>'external_comment_id')),'{}')
    INTO keys FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c;
    wanted := coalesce(array_length(keys,1),0);
    IF wanted > 0 THEN
      covered := private.reserve_usage(w, 'historical_backfill', keys);
      IF coalesce(array_length(covered,1),0) <> wanted THEN
        RAISE EXCEPTION 'quota_exceeded' USING errcode='53400';
      END IF;
    END IF;
  ELSE
    -- Live collection: meter succeeded predictions under comment_analysis
    IF jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 0 THEN
      SELECT coalesce(array_agg(DISTINCT 'analysis:'||ch_platform||':'||(p->>'external_comment_id')),'{}')
      INTO keys FROM jsonb_array_elements(payload->'predictions') p
      WHERE p->>'status'='succeeded';
      wanted := coalesce(array_length(keys,1),0);
      IF wanted > 0 THEN
        covered := private.reserve_usage(w,'comment_analysis',keys);
        IF coalesce(array_length(covered,1),0) <> wanted THEN
          RAISE EXCEPTION 'quota_exceeded' USING errcode='53400'; END IF;
      END IF;
    END IF;
  END IF;

  -- Save predictions if present
  IF jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 0 THEN
    INSERT INTO public.analysis_runs(
      workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
    SELECT DISTINCT w, p->>'model_id', p->>'revision', p->>'preprocessing_version',
           coalesce(p->'parameters','{}'::jsonb), 'succeeded'
    FROM jsonb_array_elements(payload->'predictions') p
    ON CONFLICT (workspace_id,model_id,revision_sha,preprocessing_version,parameters) DO NOTHING;

    INSERT INTO public.sentiment_predictions(
      workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
    SELECT w, cm.id, p.content_hash, r.id, p.analysis_key, p.status, p.label, p.class_scores
    FROM jsonb_to_recordset(payload->'predictions') AS p(
      external_comment_id text, content_hash text, analysis_key text, status text,
      label text, class_scores jsonb, model_id text, revision text,
      preprocessing_version text, parameters jsonb)
    JOIN public.comments cm ON cm.workspace_id=w AND cm.platform=ch_platform
      AND cm.external_comment_id=p.external_comment_id
    JOIN public.analysis_runs r ON r.workspace_id=w AND r.model_id=p.model_id
      AND r.revision_sha=p.revision AND r.preprocessing_version=p.preprocessing_version
      AND r.parameters=coalesce(p.parameters,'{}'::jsonb)
    ON CONFLICT (workspace_id,comment_id,content_hash,analysis_key) DO UPDATE SET
      status=excluded.status, label=excluded.label, class_scores=excluded.class_scores,
      analysis_run_id=excluded.analysis_run_id, predicted_at=now()
    WHERE public.sentiment_predictions.status = 'failed';
  END IF;

  INSERT INTO private.job_batches(job_id,batch_key,checkpoint,payload_hash,outcome)
  VALUES (j, b, coalesce(payload->'checkpoint','{}'::jsonb), hash, outcome);
  UPDATE public.jobs SET checkpoint=coalesce(payload->'checkpoint','{}'::jsonb) WHERE id=j;

  INSERT INTO public.sync_runs(workspace_id, channel_id, job_id, mode, source, status)
  VALUES (w, ch, j, case when is_hist then 'backfill' else 'collect' end,
          coalesce((SELECT c->>'source'
                      FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
                     LIMIT 1), 'unknown'),
          'running')
  ON CONFLICT (workspace_id, job_id) DO NOTHING;

  UPDATE public.sync_runs r SET coverage_summary = (
    WITH seen AS (
      SELECT coalesce(r.coverage_summary->'videos', '[]'::jsonb)
             || jsonb_build_array(vid::text) AS v)
    SELECT jsonb_build_object(
      'videos', (SELECT jsonb_agg(DISTINCT e)
                   FROM seen, jsonb_array_elements_text(seen.v) e),
      'videos_seen', (SELECT count(DISTINCT e)
                        FROM seen, jsonb_array_elements_text(seen.v) e),
      'comments_collected',
        coalesce((r.coverage_summary->>'comments_collected')::int, 0) + inserted,
      'complete', outcome = 'exhausted')
  )
  WHERE r.workspace_id = w AND r.job_id = j;

  RETURN jsonb_build_object('replayed', false, 'comments', inserted, 'video_id', vid);
END $$;

-- 7. User RPC: request platform historical sync (YouTube/Telegram)
create or replace function public.request_historical_platform_sync(
  w uuid, c uuid, since_date timestamptz, max_items int default 500
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  sub record;
  job_id uuid;
  ch_exists boolean;
begin
  if not private.has_role(w, array['workspace_owner', 'analyst']) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select exists(select 1 from public.channels where id = c and workspace_id = w) into ch_exists;
  if not ch_exists then
    raise exception 'channel_not_found' using errcode='22023';
  end if;

  select pl.key, pl.backfill_units, pl.historical_days_limit into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;

  if coalesce(sub.historical_days_limit, 0) = 0 then
    raise exception 'historical_sync_not_allowed_on_plan' using errcode='53400';
  end if;

  if sub.historical_days_limit is not null and sub.historical_days_limit > 0 then
    if since_date < (now() - (sub.historical_days_limit || ' days')::interval) then
      raise exception 'date_beyond_plan_limit' using errcode='22023';
    end if;
  end if;

  if private.backfill_remaining(w) <= 0 then
    raise exception 'quota_exceeded' using errcode='53400';
  end if;

  insert into public.jobs(workspace_id, channel_id, type, dedupe_key, checkpoint)
  values (w, c, 'import', 'hist_sync:' || c || ':' || extract(epoch from since_date), jsonb_build_object(
    'is_historical', true,
    'since', since_date,
    'max_items', coalesce(max_items, 500),
    'source', 'platform_sync'
  ))
  on conflict (workspace_id, dedupe_key) do update set
    checkpoint = excluded.checkpoint, status = 'queued', attempt = 0, not_before = now()
  returning id into job_id;

  return jsonb_build_object(
    'ok', true,
    'job_id', job_id,
    'status', 'queued',
    'historical_days_limit', coalesce(sub.historical_days_limit, -1),
    'backfill_remaining', private.backfill_remaining(w)
  );
end $$;
revoke all on function public.request_historical_platform_sync(uuid, uuid, timestamptz, int) from public, anon;
grant execute on function public.request_historical_platform_sync(uuid, uuid, timestamptz, int) to authenticated;

-- 8. User RPC: import external historical records from CSV or JSON
create or replace function public.import_historical_records(
  w uuid, c uuid, payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  sub record;
  ch_platform text;
  keys text[];
  covered text[];
  wanted int;
  p_rec record;
  c_rec record;
  v_id uuid;
  posts_count int := 0;
  comments_count int := 0;
  min_pub timestamptz;
begin
  if not private.has_role(w, array['workspace_owner', 'analyst']) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select coalesce(platform, 'youtube') into ch_platform
    from public.channels where id = c and workspace_id = w;
  if not found then
    raise exception 'channel_not_found' using errcode='22023';
  end if;

  select pl.key, pl.backfill_units, pl.historical_days_limit into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;

  if coalesce(sub.historical_days_limit, 0) = 0 then
    raise exception 'historical_sync_not_allowed_on_plan' using errcode='53400';
  end if;

  -- Validate comments volume (max 1000 per import request)
  if jsonb_array_length(coalesce(payload->'comments', '[]'::jsonb)) > 1000 then
    raise exception 'batch_too_large' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(payload->'comments', '[]'::jsonb)) = 0 then
    raise exception 'no_comments_provided' using errcode='22023';
  end if;

  -- If plan has historical_days_limit, ensure imported items do not exceed date depth
  if sub.historical_days_limit is not null and sub.historical_days_limit > 0 then
    select min(coalesce((comm_el->>'published_at')::timestamptz, now()))
      into min_pub
      from jsonb_array_elements(payload->'comments') comm_el
     where (comm_el->>'published_at') is not null and (comm_el->>'published_at') <> '';
    if min_pub is not null and min_pub < (now() - (sub.historical_days_limit || ' days')::interval) then
      raise exception 'date_beyond_plan_limit' using errcode='22023';
    end if;
  end if;

  -- Meter usage against historical_backfill
  select coalesce(array_agg(distinct 'backfill:' || ch_platform || ':' || (comm_el->>'external_comment_id')), '{}')
    into keys
    from jsonb_array_elements(payload->'comments') comm_el;
  wanted := coalesce(array_length(keys, 1), 0);
  if wanted > 0 then
    covered := private.reserve_usage(w, 'historical_backfill', keys);
    if coalesce(array_length(covered, 1), 0) <> wanted then
      raise exception 'quota_exceeded' using errcode='53400';
    end if;
  end if;

  -- Upsert posts/videos
  for p_rec in
    select p->>'external_video_id' as ext_id,
           coalesce(nullif(p->>'title', ''), p->>'external_video_id') as title,
           coalesce(p->>'kind', case when ch_platform = 'telegram' then 'channel_post' else 'video' end) as kind,
           nullif(p->>'published_at', '')::timestamptz as published_at
      from jsonb_array_elements(coalesce(payload->'posts', '[]'::jsonb)) p
  loop
    insert into public.videos(workspace_id, channel_id, platform, external_video_id, title, kind, published_at)
    values (w, c, ch_platform, p_rec.ext_id, p_rec.title, p_rec.kind, p_rec.published_at)
    on conflict (workspace_id, platform, external_video_id) do update set
      title = case when excluded.title <> public.videos.external_video_id then excluded.title else public.videos.title end,
      kind = coalesce(excluded.kind, public.videos.kind),
      published_at = coalesce(excluded.published_at, public.videos.published_at),
      last_observed_at = now();
    posts_count := posts_count + 1;
  end loop;

  -- Upsert comments
  for c_rec in
    select comm_el->>'external_video_id' as ext_video_id,
           comm_el->>'external_comment_id' as ext_comm_id,
           comm_el->>'external_parent_id' as ext_parent_id,
           coalesce((comm_el->>'is_reply')::boolean, false) as is_reply,
           comm_el->>'author_name' as author_name,
           comm_el->>'text_raw' as text_raw,
           coalesce(comm_el->>'text_plain', comm_el->>'text_raw') as text_plain,
           comm_el->>'content_hash' as content_hash,
           nullif(comm_el->>'published_at', '')::timestamptz as published_at,
           coalesce((comm_el->>'likes_value')::bigint, 0) as likes_value
      from jsonb_array_elements(payload->'comments') comm_el
  loop
    -- Ensure video exists
    insert into public.videos(workspace_id, channel_id, platform, external_video_id, title, kind)
    values (w, c, ch_platform, c_rec.ext_video_id, c_rec.ext_video_id, case when ch_platform = 'telegram' then 'channel_post' else 'video' end)
    on conflict (workspace_id, platform, external_video_id) do update set last_observed_at = now()
    returning id into v_id;

    -- Upsert comment
    insert into public.comments(
      workspace_id, video_id, platform, external_comment_id, external_parent_id,
      is_reply, author_name, text_raw, text_plain, content_hash,
      timestamp_precision, published_at, likes_value, source, field_provenance
    )
    values (
      w, v_id, ch_platform, c_rec.ext_comm_id, c_rec.ext_parent_id,
      c_rec.is_reply, coalesce(c_rec.author_name, ''), c_rec.text_raw, c_rec.text_plain,
      coalesce(nullif(c_rec.content_hash, ''), md5(c_rec.text_raw)),
      'second', coalesce(c_rec.published_at, now()), c_rec.likes_value, 'external_import',
      jsonb_build_object('imported_at', now(), 'source', 'file_upload')
    )
    on conflict (workspace_id, platform, external_comment_id) do update set
      text_raw = excluded.text_raw,
      text_plain = excluded.text_plain,
      likes_value = excluded.likes_value,
      last_seen_at = now();
    comments_count := comments_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'posts_count', posts_count,
    'comments_count', comments_count,
    'backfill_units_used', wanted,
    'backfill_units_remaining', private.backfill_remaining(w)
  );
end $$;
revoke all on function public.import_historical_records(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_historical_records(uuid, uuid, jsonb) to authenticated;
