-- The dashboard's numbers are computed away from the page's read.
--
-- `dashboard_aggregates` re-counted every comment of the workspace (five
-- DISTINCT ON joins over reviews, predictions, topics and annotations) on each
-- load, under a 30 s ceiling. The cost grows with the workspace and with what
-- the worker is writing, so the ceiling is crossed sooner or later and the page
-- fails with `read:live_unavailable:57014`. It was patched five times (windowing,
-- indexes, a bigger timeout, retries, a lighter ops read); each patch moved the
-- ceiling and none removed it, because the read itself still did the work.
--
-- Now the read only looks a row up. A row per (workspace, filter set) holds the
-- last computed payload; `drain_dashboard_aggregates` (pg_cron, every minute)
-- recomputes the rows somebody asked for, under a 10 minute budget instead of 30
-- seconds, and never more than once per row no matter how many viewers, tabs or
-- retries asked. A row is served stale while its refresh is queued, so a slow
-- compute costs freshness, never availability.
--
-- The compute itself is untouched: the old function is renamed, not rewritten,
-- so every filter and effective-label rule stays in one place.

alter function private.dashboard_aggregates_impl(uuid, jsonb)
  rename to dashboard_aggregates_compute;
-- Called only from the drain below. The 30 s it carried would not bind inside the
-- drain anyway (a function's SET does not re-arm the timer of the statement that
-- called it); the cron command sets the real budget.
alter function private.dashboard_aggregates_compute(uuid, jsonb)
  reset statement_timeout;
revoke all on function private.dashboard_aggregates_compute(uuid, jsonb) from public, anon;
grant execute on function private.dashboard_aggregates_compute(uuid, jsonb)
  to authenticated, service_role;

create table private.dashboard_aggregates_cache (
  workspace_id    uuid        not null references public.workspaces(id) on delete cascade,
  filter_key      text        not null,
  filters         jsonb       not null,
  payload         jsonb,
  computed_at     timestamptz,
  requested_at    timestamptz not null default now(),
  attempts        int         not null default 0,
  next_attempt_at timestamptz,
  last_error      text,
  primary key (workspace_id, filter_key)
);
alter table private.dashboard_aggregates_cache enable row level security;
revoke all on table private.dashboard_aggregates_cache from public, anon, authenticated;
create index dashboard_aggregates_cache_due_idx
  on private.dashboard_aggregates_cache (requested_at);

-- A payload newer than this is answered as `fresh`; older is served as `stale`
-- while the refresh is queued.
create function private.dashboard_aggregates_fresh_for() returns interval
language sql immutable as $$ select interval '60 seconds' $$;

create function private.dashboard_aggregates_impl(w uuid, f jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  filters jsonb := jsonb_strip_nulls(coalesce(f, '{}'::jsonb));
  k       text;
  c       private.dashboard_aggregates_cache;
  stale   boolean;
begin
  if not (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
          or private.has_role(w)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Free-text search is open-ended (a row per typed string would never be read
  -- twice) and is served by the trigram index, so it is still answered live.
  if nullif(trim(filters->>'q'), '') is not null then
    return private.dashboard_aggregates_compute(w, filters);
  end if;

  k := md5(filters::text);

  select * into c from private.dashboard_aggregates_cache
   where workspace_id = w and filter_key = k;

  if not found then
    insert into private.dashboard_aggregates_cache(workspace_id, filter_key, filters)
    values (w, k, filters)
    on conflict do nothing;
    return jsonb_build_object('cache', jsonb_build_object('state', 'pending'));
  end if;

  if c.payload is null then
    update private.dashboard_aggregates_cache
       set requested_at = now()
     where workspace_id = w and filter_key = k;
    if c.last_error is not null then
      return jsonb_build_object('cache',
        jsonb_build_object('state', 'failed', 'error', c.last_error));
    end if;
    return jsonb_build_object('cache', jsonb_build_object('state', 'pending'));
  end if;

  stale := c.computed_at < now() - private.dashboard_aggregates_fresh_for();
  if stale or c.requested_at < now() - interval '1 hour' then
    -- Queue a refresh (and keep the row alive); once per staleness, not per read.
    if c.requested_at <= c.computed_at or c.requested_at < now() - interval '1 hour' then
      update private.dashboard_aggregates_cache
         set requested_at = now()
       where workspace_id = w and filter_key = k;
    end if;
  end if;

  return c.payload || jsonb_build_object('cache', jsonb_build_object(
    'state', case when stale then 'stale' else 'fresh' end,
    'computed_at', c.computed_at));
end
$fn$;
revoke all on function private.dashboard_aggregates_impl(uuid, jsonb) from public, anon;
grant execute on function private.dashboard_aggregates_impl(uuid, jsonb)
  to authenticated, service_role;

-- The wrapper writes now (a row per new filter set), so it is VOLATILE. The
-- 30 s stays for the live free-text path above.
create or replace function public.dashboard_aggregates(w uuid, f jsonb default '{}'::jsonb)
returns jsonb language sql volatile security definer set search_path = ''
set statement_timeout = '30s' as $$
  select private.dashboard_aggregates_impl(w, f);
$$;
revoke all on function public.dashboard_aggregates(uuid, jsonb) from public;
grant execute on function public.dashboard_aggregates(uuid, jsonb) to authenticated, service_role;

-- Recompute the rows somebody asked for. A row that fails keeps its last good
-- payload, records the SQLSTATE (the page shows it) and waits longer each time.
create function private.drain_dashboard_aggregates(max_rows int default 2)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r record;
  done int := 0;
begin
  delete from private.dashboard_aggregates_cache
   where requested_at < now() - interval '7 days';

  for r in
    select workspace_id, filter_key, filters
      from private.dashboard_aggregates_cache
     where (computed_at is null or requested_at > computed_at)
       and coalesce(next_attempt_at, '-infinity') <= now()
     order by requested_at
     limit max_rows
       for update skip locked
  loop
    -- compute authorises as the service role; the row was authorised when asked.
    perform set_config('request.jwt.claim.role', 'service_role', true);
    begin
      update private.dashboard_aggregates_cache
         set payload = private.dashboard_aggregates_compute(r.workspace_id, r.filters),
             computed_at = now(), attempts = 0, next_attempt_at = null, last_error = null
       where workspace_id = r.workspace_id and filter_key = r.filter_key;
      done := done + 1;
    exception when others then
      update private.dashboard_aggregates_cache
         set attempts = attempts + 1,
             last_error = sqlstate,
             next_attempt_at = now() + make_interval(secs => least(60 * power(2, attempts), 3600))
       where workspace_id = r.workspace_id and filter_key = r.filter_key;
    end;
  end loop;
  perform set_config('request.jwt.claim.role', '', true);
  return done;
end
$fn$;
revoke all on function private.drain_dashboard_aggregates(int) from public, anon, authenticated;

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping the dashboard cache drain';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid) from cron.job where jobname = 'dashboard-aggregates-drain';

  -- One transaction, so SET LOCAL holds for the drain: the budget is 10 minutes,
  -- not the 30 seconds a page read has to live with.
  perform cron.schedule(
    'dashboard-aggregates-drain',
    '* * * * *',
    $job$set local statement_timeout = '10min'; select private.drain_dashboard_aggregates(2)$job$
  );
end;
$schedule$;
