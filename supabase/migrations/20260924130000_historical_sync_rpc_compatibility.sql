-- Migration: 20260924130000_historical_sync_rpc_compatibility.sql
-- Fixes:
-- 1. Fix historical_days_limit check for unlimited plans (owner, enterprise where historical_days_limit is null)
-- 2. Provide PostgREST RPC overload for request_historical_platform_sync supporting both (w, c, since_date, max_items)
--    and (w, p_channel_id, p_days_back, p_max_items, p_published_after)
-- 3. Update import_historical_records to support flexible parameter signatures and fix null historical_days_limit

-- A. Canonical request_historical_platform_sync with unlimited plan fix
create or replace function public.request_historical_platform_sync(
  w uuid, c uuid, since_date timestamptz, max_items int default 500
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  sub record;
  job_id uuid;
  ch_exists boolean;
  effective_since timestamptz;
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

  -- Only block if explicitly set to 0 (e.g. Free tier). NULL means unlimited (Owner / Enterprise).
  if sub.historical_days_limit is not null and sub.historical_days_limit = 0 then
    raise exception 'historical_sync_not_allowed_on_plan' using errcode='53400';
  end if;

  effective_since := coalesce(since_date, now() - interval '30 days');

  if sub.historical_days_limit is not null and sub.historical_days_limit > 0 then
    if effective_since < (now() - (sub.historical_days_limit || ' days')::interval) then
      raise exception 'date_beyond_plan_limit' using errcode='22023';
    end if;
  end if;

  if private.backfill_remaining(w) <= 0 then
    raise exception 'quota_exceeded' using errcode='53400';
  end if;

  insert into public.jobs(workspace_id, channel_id, type, dedupe_key, checkpoint)
  values (w, c, 'import', 'hist_sync:' || c || ':' || extract(epoch from effective_since), jsonb_build_object(
    'is_historical', true,
    'since', effective_since,
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

-- B. Overload supporting client calls using p_channel_id, p_days_back, etc.
create or replace function public.request_historical_platform_sync(
  w uuid,
  p_channel_id uuid,
  p_days_back int default null,
  p_max_items int default 500,
  p_published_after timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  calc_since timestamptz;
begin
  if p_published_after is not null then
    calc_since := p_published_after;
  elsif p_days_back is not null and p_days_back > 0 then
    calc_since := now() - (p_days_back || ' days')::interval;
  else
    calc_since := now() - interval '30 days';
  end if;

  return public.request_historical_platform_sync(
    w => w,
    c => p_channel_id,
    since_date => calc_since,
    max_items => coalesce(p_max_items, 500)
  );
end $$;

revoke all on function public.request_historical_platform_sync(uuid, uuid, int, int, timestamptz) from public, anon;
grant execute on function public.request_historical_platform_sync(uuid, uuid, int, int, timestamptz) to authenticated;

-- C. Flexible import_historical_records accepting (w, c, payload) and (w, p_channel_id, p_payload)
drop function if exists public.import_historical_records(uuid, uuid, jsonb);

create or replace function public.import_historical_records(
  w uuid,
  c uuid default null,
  payload jsonb default null,
  p_channel_id uuid default null,
  p_payload jsonb default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  effective_c uuid;
  effective_payload jsonb;
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

  effective_c := coalesce(c, p_channel_id);
  effective_payload := coalesce(payload, p_payload);

  if effective_c is null then
    raise exception 'channel_not_found' using errcode='22023';
  end if;

  select coalesce(platform, 'youtube') into ch_platform
    from public.channels where id = effective_c and workspace_id = w;
  if not found then
    raise exception 'channel_not_found' using errcode='22023';
  end if;

  select pl.key, pl.backfill_units, pl.historical_days_limit into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;

  -- Only block if explicitly set to 0. NULL means unlimited (Owner / Enterprise).
  if sub.historical_days_limit is not null and sub.historical_days_limit = 0 then
    raise exception 'historical_sync_not_allowed_on_plan' using errcode='53400';
  end if;

  if effective_payload is null or jsonb_typeof(effective_payload) != 'object' then
    raise exception 'invalid_payload' using errcode='22023';
  end if;

  -- Validate comments volume (max 1000 per import request)
  if jsonb_array_length(coalesce(effective_payload->'comments', '[]'::jsonb)) > 1000 then
    raise exception 'batch_too_large' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(effective_payload->'comments', '[]'::jsonb)) = 0 then
    raise exception 'no_comments_provided' using errcode='22023';
  end if;

  -- If plan has historical_days_limit > 0, ensure imported items do not exceed date depth
  if sub.historical_days_limit is not null and sub.historical_days_limit > 0 then
    select min(coalesce((comm_el->>'published_at')::timestamptz, now()))
      into min_pub
      from jsonb_array_elements(effective_payload->'comments') comm_el
     where (comm_el->>'published_at') is not null and (comm_el->>'published_at') <> '';

    if min_pub is not null and min_pub < (now() - (sub.historical_days_limit || ' days')::interval) then
      raise exception 'date_beyond_plan_limit' using errcode='22023';
    end if;
  end if;

  -- Meter usage against historical_backfill
  select coalesce(array_agg(distinct 'backfill:' || ch_platform || ':' || (comm_el->>'external_comment_id')), '{}')
    into keys
    from jsonb_array_elements(effective_payload->'comments') comm_el;
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
      from jsonb_array_elements(coalesce(effective_payload->'posts', '[]'::jsonb)) p
  loop
    insert into public.videos(workspace_id, channel_id, platform, external_video_id, title, kind, published_at)
    values (w, effective_c, ch_platform, p_rec.ext_id, p_rec.title, p_rec.kind, p_rec.published_at)
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
      from jsonb_array_elements(effective_payload->'comments') comm_el
  loop
    -- Ensure video exists
    insert into public.videos(workspace_id, channel_id, platform, external_video_id, title, kind)
    values (w, effective_c, ch_platform, c_rec.ext_video_id, c_rec.ext_video_id, case when ch_platform = 'telegram' then 'channel_post' else 'video' end)
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

revoke all on function public.import_historical_records(uuid, uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.import_historical_records(uuid, uuid, jsonb, uuid, jsonb) to authenticated;
