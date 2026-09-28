-- WO-5a PR 1: Unlimited-plan overflow protection, bigint usage arithmetic, and worker job retries.
-- Timestamp: 20260930000000

-- 1. Clean existing magic number (2147483647) back to NULL where applicable (internal plans)
update public.plans set backfill_units = null where backfill_units >= 2147483647 and internal;
update public.plans set topic_units = null where topic_units >= 2147483647 and internal;
update public.plans set analysis_units = null where analysis_units >= 2147483647 and internal;

-- 2. Update public.update_plan_limits to properly handle unlimited values (-1)
create or replace function public.update_plan_limits(
  p_plan_key text,
  p_limits jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target_plan public.plans%rowtype;
  updated_plan public.plans%rowtype;
  v_analysis_units int;
  v_channels_limit int;
  v_members_limit int;
  v_workspaces_limit int;
  v_backfill_units int;
  v_topic_units int;
  v_historical_days_limit int;
  v_insight_reports int;
  v_live_interval_minutes int;
  v_allow_public_channels boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into target_plan from public.plans where key = p_plan_key;
  if not found then
    raise exception 'plan_not_found' using errcode='P0002';
  end if;

  -- historical_days_limit has no check constraint and can be true NULL across all plans
  v_historical_days_limit := case
    when p_limits ? 'historical_days_limit' then
      case when (p_limits->>'historical_days_limit')::int = -1 then null else (p_limits->>'historical_days_limit')::int end
    else target_plan.historical_days_limit end;

  -- backfill_units, topic_units, analysis_units, channels_limit, members_limit, workspaces_limit
  -- are governed by plans_limits_finite_unless_internal check constraint
  v_backfill_units := case
    when p_limits ? 'backfill_units' then
      case when (p_limits->>'backfill_units')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'backfill_units')::int end
    else target_plan.backfill_units end;

  v_topic_units := case
    when p_limits ? 'topic_units' then
      case when (p_limits->>'topic_units')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'topic_units')::int end
    else target_plan.topic_units end;

  v_analysis_units := case
    when p_limits ? 'analysis_units' then
      case when (p_limits->>'analysis_units')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'analysis_units')::int end
    else target_plan.analysis_units end;

  v_channels_limit := case
    when p_limits ? 'channels_limit' then
      case when (p_limits->>'channels_limit')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'channels_limit')::int end
    when p_limits ? 'channels' then
      case when (p_limits->>'channels')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'channels')::int end
    else target_plan.channels_limit end;

  v_members_limit := case
    when p_limits ? 'members_limit' then
      case when (p_limits->>'members_limit')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'members_limit')::int end
    when p_limits ? 'members' then
      case when (p_limits->>'members')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'members')::int end
    else target_plan.members_limit end;

  v_workspaces_limit := case
    when p_limits ? 'workspaces_limit' then
      case when (p_limits->>'workspaces_limit')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'workspaces_limit')::int end
    when p_limits ? 'workspaces' then
      case when (p_limits->>'workspaces')::int = -1 then
        case when target_plan.internal then null else 2147483647 end
      else (p_limits->>'workspaces')::int end
    else target_plan.workspaces_limit end;

  v_insight_reports := case
    when p_limits ? 'insight_reports' then (p_limits->>'insight_reports')::int
    else target_plan.insight_reports end;

  v_live_interval_minutes := case
    when p_limits ? 'live_interval_minutes' then (p_limits->>'live_interval_minutes')::int
    else target_plan.live_interval_minutes end;

  v_allow_public_channels := case
    when p_limits ? 'allow_public_channels' then (p_limits->>'allow_public_channels')::boolean
    else target_plan.allow_public_channels end;

  update public.plans
     set backfill_units = v_backfill_units,
         historical_days_limit = v_historical_days_limit,
         analysis_units = v_analysis_units,
         topic_units = v_topic_units,
         channels_limit = v_channels_limit,
         members_limit = v_members_limit,
         workspaces_limit = v_workspaces_limit,
         insight_reports = v_insight_reports,
         live_interval_minutes = v_live_interval_minutes,
         allow_public_channels = v_allow_public_channels
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

-- 3. Update private.plan_json to format unlimited values consistently as -1
create or replace function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'allow_public_channels', coalesce(p.allow_public_channels, false),
    'backfill_units', case when p.backfill_units is null or p.backfill_units < 0 or p.backfill_units >= 2147483647 then -1 else p.backfill_units end,
    'historical_days_limit', coalesce(p.historical_days_limit, -1),
    'limits', jsonb_build_object(
      'analysis_units', case when p.analysis_units is null or p.analysis_units < 0 or p.analysis_units >= 2147483647 then -1 else p.analysis_units end,
      'topic_units', case when p.topic_units is null or p.topic_units < 0 or p.topic_units >= 2147483647 then -1 else p.topic_units end,
      'insight_reports', coalesce(p.insight_reports, 0),
      'channels', case when p.channels_limit is null or p.channels_limit < 0 or p.channels_limit >= 2147483647 then -1 else p.channels_limit end,
      'members', case when p.members_limit is null or p.members_limit < 0 or p.members_limit >= 2147483647 then -1 else p.members_limit end,
      'workspaces', case when p.workspaces_limit is null or p.workspaces_limit < 0 or p.workspaces_limit >= 2147483647 then -1 else p.workspaces_limit end,
      'live_interval_minutes', coalesce(p.live_interval_minutes, 0)));
$$;
revoke all on function private.plan_json(public.plans) from public, anon, authenticated;

-- 4. Drop and recreate private.budget_entry with bigint arithmetic
drop function if exists private.budget_entry(text, int, int, int);
drop function if exists private.budget_entry(text, bigint, bigint, bigint);

create or replace function private.budget_entry(
  kind text,
  allowance bigint,
  used bigint,
  granted bigint default 0
) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'event_type', kind,
    'allowance', case when allowance is null or allowance < 0 or allowance = 2147483647 then -1 else (allowance + granted) end,
    'granted', granted,
    'used', used,
    'remaining', case when allowance is null or allowance < 0 or allowance = 2147483647 then -1 else greatest((allowance + granted) - used, 0::bigint) end
  );
$$;
revoke all on function private.budget_entry(text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function private.budget_entry(text, bigint, bigint, bigint) to service_role;

-- 5. Upgrade private.granted_units to return bigint
drop function if exists private.granted_units(uuid, text);
create or replace function private.granted_units(w uuid, kind text) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(g.units), 0)::bigint
    from public.usage_grants g
   where g.kind = granted_units.kind and g.expires_at > now()
     and g.workspace_id in (select s.workspace_id from public.subscriptions s
                            where coalesce(s.billing_workspace_id, s.workspace_id) = private.billing_root(w));
$$;
revoke all on function private.granted_units(uuid, text) from public, anon, authenticated;
grant execute on function private.granted_units(uuid, text) to service_role;

-- 6. Upgrade private.used_units to return bigint
drop function if exists private.used_units(uuid, text, timestamptz);
create or replace function private.used_units(w uuid, kind text, since timestamptz) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(u.units), 0)::bigint
    from public.usage_events u
   where u.event_type = used_units.kind and u.period_start = since
     and u.workspace_id in (select s.workspace_id from public.subscriptions s
                            where coalesce(s.billing_workspace_id, s.workspace_id) = private.billing_root(w));
$$;
revoke all on function private.used_units(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function private.used_units(uuid, text, timestamptz) to service_role;

-- 7. Upgrade analysis_remaining, topic_units_remaining, and backfill_remaining to return bigint (NULL when unlimited)
drop function if exists private.analysis_remaining(uuid);
create or replace function private.analysis_remaining(w uuid) returns bigint
language plpgsql stable security definer set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.analysis_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  if sub.analysis_units is null or sub.analysis_units >= 2147483647 then return null; end if;
  return greatest(0::bigint, sub.analysis_units::bigint + private.granted_units(w, 'comment_analysis')
                     - private.used_units(w, 'comment_analysis', sub.period_start));
end $$;
revoke all on function private.analysis_remaining(uuid) from public, anon, authenticated;
grant execute on function private.analysis_remaining(uuid) to service_role;

drop function if exists private.topic_units_remaining(uuid);
create or replace function private.topic_units_remaining(w uuid) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.topic_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then return null; end if;
  if sub.topic_units is null or sub.topic_units >= 2147483647 then return null; end if;
  return greatest(0::bigint, sub.topic_units::bigint + private.granted_units(w, 'topic_classification')
                     - private.used_units(w, 'topic_classification', sub.period_start));
end $$;
revoke all on function private.topic_units_remaining(uuid) from public, anon, authenticated;
grant execute on function private.topic_units_remaining(uuid) to service_role;

drop function if exists private.backfill_remaining(uuid);
create or replace function private.backfill_remaining(w uuid) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.backfill_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  if sub.backfill_units is null or sub.backfill_units >= 2147483647 then return null; end if;
  return greatest(0::bigint, sub.backfill_units::bigint + private.granted_units(w, 'historical_backfill')
                     - private.used_units(w, 'historical_backfill', sub.period_start));
end $$;
revoke all on function private.backfill_remaining(uuid) from public, anon, authenticated;
grant execute on function private.backfill_remaining(uuid) to service_role;

-- 8. Upgrade private.reserve_usage to bigint
create or replace function private.reserve_usage(w uuid, kind text, keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare
  sub record;
  allowance bigint;
  used bigint;
  covered text[];
  fresh text[];
begin
  if kind not in ('comment_analysis', 'historical_backfill', 'topic_classification') then
    raise exception 'invalid_event_type' using errcode='22023';
  end if;
  if coalesce(array_length(keys, 1), 0) > 500 then
    raise exception 'batch_too_large' using errcode='22023';
  end if;

  select private.subscription_open(s) as open, s.period_start,
         pl.analysis_units, pl.backfill_units, pl.topic_units
    into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) for update of s;
  if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
  if not sub.open then raise exception 'plan_inactive' using errcode='42501'; end if;

  allowance := case kind
    when 'comment_analysis' then sub.analysis_units
    when 'historical_backfill' then sub.backfill_units
    else sub.topic_units
  end;

  select coalesce(array_agg(u.event_key), '{}') into covered
    from public.usage_events u
   where u.workspace_id = w and u.event_key = any(keys);

  select coalesce(array_agg(distinct k), '{}') into fresh
    from unnest(keys) as k
   where not (k = any(covered));

  if allowance is not null and allowance < 2147483647 then
    allowance := allowance + private.granted_units(w, kind);
    used := private.used_units(w, kind, sub.period_start);
    fresh := fresh[1:greatest(allowance - used, 0::bigint)];
  end if;

  insert into public.usage_events(workspace_id, period_start, event_key, event_type)
  select w, sub.period_start, k, kind from unnest(fresh) as k;

  return covered || fresh;
end $$;
revoke all on function private.reserve_usage(uuid, text, text[]) from public, anon, authenticated;
grant execute on function private.reserve_usage(uuid, text, text[]) to service_role;

-- 9. Upgrade private.select_videos_impl to handle NULL remaining
create or replace function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate bigint := 0; unknowns int := 0; outstanding bigint := 0; remaining bigint; j uuid;
        queued boolean := false; deferred boolean := false; running boolean := false;
        rec record;
begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  add := coalesce(add, '{}'::uuid[]); remove := coalesce(remove, '{}'::uuid[]);
  if exists(select 1 from unnest(add || remove) x(id)
             where not exists(select 1 from public.videos v
                               where v.workspace_id=w and v.channel_id=c and v.id=x.id)) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  if exists(select 1 from public.videos v
             where v.workspace_id=w and v.id = any(add) and v.comments_state='disabled') then
    raise exception 'comments_disabled' using errcode='22023'; end if;

  -- Comments already in the database were already metered. A null count adds
  -- nothing to the sum and is reported apart, never as zero.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::bigint,
         count(*) filter (where v.reported_comment_count is null)::int
    into estimate, unknowns
    from public.videos v
   where v.workspace_id=w and v.id = any(add)
     and not exists(select 1 from public.video_selections s
                     where s.workspace_id=w and s.video_id=v.id);

  -- What is already chosen and not yet stored, priced the same way, across
  -- the whole workspace and before this call writes anything.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::bigint
    into outstanding
    from public.video_selections s
    join public.videos v on v.workspace_id=w and v.id=s.video_id
   where s.workspace_id=w and not (s.video_id = any(remove));

  -- A removal alone spends nothing and needs no plan: a paused tenant can still deselect.
  if cardinality(add) > 0 then
    remaining := private.analysis_remaining(w);
    if remaining is not null and estimate + outstanding > remaining then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  -- Adopt comments and predictions from other workspaces for the newly selected videos
  if cardinality(add) > 0 then
    for rec in select x.id as video_id from unnest(add) x(id) loop
      perform private.adopt_video_comments_and_predictions(w, rec.video_id);
    end loop;
  end if;

  if cardinality(add) > 0 then
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='collect' and status='running'
     order by created_at limit 1;
    if j is not null then
      running := true;
    else
      begin
        j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
        select status = 'running' into running from public.jobs where id = j;
        queued := not running;
      exception when sqlstate '53400' then
        deferred := true;
      end;
    end if;
  end if;

  return jsonb_build_object('job_id', j, 'queued', queued, 'deferred', deferred,
                            'already_running', running,
                            'estimate', estimate, 'unknown_count', unknowns,
                            'outstanding', outstanding,
                            'remaining_after', case when remaining is null then -1 else remaining - outstanding - estimate end);
end $$;
revoke all on function private.select_videos_impl(uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function private.select_videos_impl(uuid, uuid, uuid[], uuid[]) to authenticated;

-- 10. Upgrade private.worker_topics_due to handle NULL unlimited topic remaining
create or replace function private.worker_topics_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  w uuid; c uuid; p text; kind text; k text; active text; rows jsonb; taxonomy jsonb;
  remaining bigint; sub_open boolean;
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
    where (sub_open and (remaining is null or not d.costs or d.spent <= remaining))
    order by d.published_at nulls last, d.id
    limit least(greatest(coalesce(max_rows, 200), 1), 200)
    ) e;

  if jsonb_array_length(rows) = 0 and (not sub_open or (remaining is not null and remaining = 0))
     and private.topics_pending(w, c) then
    return jsonb_build_object('classification_key', k, 'active', true,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'blocked', 'quota_exceeded');
  end if;
  return jsonb_build_object('classification_key', k, 'active', true,
                            'taxonomy', taxonomy, 'rows', rows);
end $$;
revoke all on function private.worker_topics_due(text, uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function private.worker_topics_due(text, uuid, uuid, text, text, int) to service_role;

-- 11. Upgrade private.worker_finish to implement exponential backoff retry lifecycle
create or replace function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare
  w uuid;
  ch uuid;
  start_time timestamptz;
  dur_sec integer;
  j_attempt integer;
  backoff_seconds integer;
begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;

  select created_at, attempt into start_time, j_attempt from public.jobs where id = j;
  dur_sec := greatest(1, round(extract(epoch from (now() - coalesce(start_time, now())))))::int;

  -- Exponential backoff retry lifecycle for transient failures on attempts 1 and 2
  if outcome in ('failed', 'partial') and coalesce(j_attempt, 1) < 3 then
    backoff_seconds := least(30 * (2 ^ coalesce(j_attempt, 1)), 600);

    update public.jobs
       set status = 'queued',
           not_before = now() + (backoff_seconds || ' seconds')::interval,
           lease_token = null,
           lease_expires_at = null,
           error_code = reason,
           last_error = coalesce(reason, public.jobs.last_error),
           counters = jsonb_set(
             coalesce(counters, '{}'::jsonb),
             '{duration_seconds}',
             to_jsonb(dur_sec)
           )
     where id = j
     returning workspace_id, channel_id into w, ch;

    insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                                 status, ended_at, error_code)
    values (w, ch, j, 'collect', 'unknown', outcome, now(), reason)
    on conflict (workspace_id, job_id) do update
      set status = excluded.status,
          ended_at = excluded.ended_at,
          error_code = excluded.error_code;
    return;
  end if;

  update public.jobs set status = outcome,
    error_code = case
      when outcome = 'succeeded' then null
      when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
      else reason
    end,
    last_error = case
      when outcome = 'succeeded' then null
      when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
      else coalesce(reason, public.jobs.last_error)
    end,
    counters = jsonb_set(
      coalesce(counters, '{}'::jsonb),
      '{duration_seconds}',
      to_jsonb(dur_sec)
    ),
    lease_token = null, lease_expires_at = null
  where id = j
  returning workspace_id, channel_id into w, ch;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status, ended_at, error_code)
  values (w, ch, j, 'collect', 'unknown', outcome, now(),
          case
            when outcome = 'succeeded' then null
            when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
            else reason
          end)
  on conflict (workspace_id, job_id) do update
    set status = excluded.status,
        ended_at = excluded.ended_at,
        error_code = excluded.error_code;
end $$;
grant execute on function private.worker_finish(text, uuid, uuid, text, text) to service_role;
