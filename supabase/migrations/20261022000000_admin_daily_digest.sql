-- The owner's daily summary (phase 4, owner choice 2026-10-10: shown in the
-- owner console, nothing sent anywhere).
--
-- Each morning `private.record_admin_digest()` keeps one snapshot of the
-- platform in `private.admin_digests`: the channel states, which channels
-- fail and why, the comment and analysis totals, the runs that failed and
-- the channels imported in the last 24 hours, and the three biggest weekly
-- changes in net sentiment (from the comparison page's counts,
-- 20261021000000). The home page compares today's snapshot with the one
-- before it: what started failing, what recovered, how many comments were
-- collected and analysed in between.
--
-- pg_cron records it at 03:53 UTC (06:53 in Doha and Riyadh); this
-- migration records the first one, so the card is there after the deploy
-- and its comparison starts with the next morning's. Thirty days are kept.

create table private.admin_digests (
  day date primary key,
  recorded_at timestamptz not null,
  body jsonb not null
);
alter table private.admin_digests enable row level security;
revoke all on table private.admin_digests from public, anon, authenticated;

create function private.build_admin_digest()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  today date := (now() at time zone 'UTC')::date;
begin
  with st as (select * from private.admin_channel_states()),
  -- One row per YouTube channel, through the copy with the most judged
  -- comments, as the comparison page shows it.
  weeks as (
    select x.workspace_id, x.channel_id,
           coalesce(sum(x.positive) filter (where x.day > today - 7), 0) as wp,
           coalesce(sum(x.negative) filter (where x.day > today - 7), 0) as wn,
           coalesce(sum(x.positive) filter (where x.day > today - 14 and x.day <= today - 7), 0) as pp,
           coalesce(sum(x.negative) filter (where x.day > today - 14 and x.day <= today - 7), 0) as pn,
           sum(x.positive + x.negative) as polar
      from private.channel_compare_cells x
     group by x.workspace_id, x.channel_id
  ),
  movers as (
    select distinct on (c.platform, c.external_channel_id)
           c.id, c.workspace_id, c.title, c.handle,
           round(((w.wp - w.wn)::numeric / (w.wp + w.wn)
                - (w.pp - w.pn)::numeric / (w.pp + w.pn)) * 100, 1) as change
      from weeks w
      join public.channels c on c.workspace_id = w.workspace_id and c.id = w.channel_id
     where w.wp + w.wn >= 20 and w.pp + w.pn >= 20
     order by c.platform, c.external_channel_id, w.polar desc, c.id
  )
  select jsonb_build_object(
    'states', jsonb_build_object(
      'paused', (select count(*) from st where state = 'paused'),
      'cataloguing', (select count(*) from st where state = 'cataloguing'),
      'collecting', (select count(*) from st where state = 'collecting'),
      'failing', (select count(*) from st where state = 'failing'),
      'new', (select count(*) from st where state = 'new'),
      'waiting', (select count(*) from st where state = 'waiting'),
      'stale', (select count(*) from st where state = 'stale'),
      'healthy', (select count(*) from st where state = 'healthy')),
    'failing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel_id', s.channel_id,
               'title', c.title,
               'handle', c.handle,
               'error_code', s.last_error)
             order by c.title nulls last, s.channel_id)
        from st s
        join public.channels c on c.id = s.channel_id
       where s.state = 'failing'), '[]'::jsonb),
    'comments', (select coalesce(sum(total), 0) from private.video_comment_stats),
    'analysed', (select coalesce(sum(analysed), 0) from private.video_comment_stats),
    'failed_runs', (select count(*) from public.sync_runs
                     where status = 'failed' and started_at >= now() - interval '24 hours'),
    'imported', (select count(*) from public.audit_events
                  where action = 'channel_imported' and created_at >= now() - interval '24 hours'),
    'movers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel_id', m.id,
               'title', m.title,
               'handle', m.handle,
               'change', m.change)
             order by abs(m.change) desc, m.id)
        from (select * from movers where change <> 0
               order by abs(change) desc, id limit 3) m), '[]'::jsonb))
  into result;
  return result;
end;
$$;

create function private.record_admin_digest()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
begin
  insert into private.admin_digests(day, recorded_at, body)
  values ((now() at time zone 'UTC')::date, now(), private.build_admin_digest())
  on conflict (day) do update
    set recorded_at = excluded.recorded_at, body = excluded.body;
  delete from private.admin_digests
   where day < (now() at time zone 'UTC')::date - 30;
end;
$$;

revoke all on function private.build_admin_digest() from public, anon, authenticated;
revoke all on function private.record_admin_digest() from public, anon, authenticated;

-- The latest snapshot and the one before it, for the home page to compare.
create or replace function public.admin_daily_digest()
returns jsonb
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'latest', (select jsonb_build_object('day', d.day, 'recorded_at', d.recorded_at, 'body', d.body)
                 from private.admin_digests d order by d.day desc limit 1),
    'previous', (select jsonb_build_object('day', d.day, 'recorded_at', d.recorded_at, 'body', d.body)
                   from private.admin_digests d order by d.day desc offset 1 limit 1))
    into result;
  return result;
end $$;

revoke all on function public.admin_daily_digest() from public, anon;
grant execute on function public.admin_daily_digest() to authenticated;

select private.record_admin_digest();

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping admin-daily-digest schedule';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'admin-daily-digest';

  perform cron.schedule(
    'admin-daily-digest',
    '53 3 * * *',
    $job$select private.record_admin_digest()$job$
  );
end;
$schedule$;
