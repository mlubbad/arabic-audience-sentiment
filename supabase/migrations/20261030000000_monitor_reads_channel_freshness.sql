-- The external monitor reads, per channel, whether collection is arriving.
--
-- `scripts/monitor.sh` judged freshness by the newest prediction anywhere on
-- the platform. One healthy channel hid every stalled one: on 2026-10-16 it
-- reported "newest prediction 1h old, OK" while 16 of the 18 channels with
-- selected videos had not had a successful collection in 48 hours (7 never
-- had one), each blocked about 44 times in those 48 hours, mostly on
-- quota_exceeded.
--
-- This counts, with the owner console's own rule
-- (`private.admin_channel_states`, 20261018000000), the channels that are
-- being collected and the ones among them that are stale:
--   collected  not paused, catalogued, at least one video selected;
--   stale      collected, and the last succeeded or partial collect run
--              ended more than 48 hours ago, or there never was one and
--              the first selection is itself older than 48 hours (a channel
--              selected an hour ago has not had its chance yet);
--   never      stale channels that have never collected successfully.
-- The console's state label is not used for the verdict: a channel whose
-- collect job is queued again every hour reads as 'collecting' there, which
-- is exactly the channel that never succeeds.
--
-- Counts only. The monitor runs in a public repository's workflow, so the
-- answer names no channel, workspace or error text. It is granted to
-- service_role alone; a tenant key gets "permission denied".

create function public.svc_monitor_channel_freshness()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
  with collected as (
    select s.last_ok_at,
           (select min(v.selected_at) from public.video_selections v
             where v.workspace_id = s.workspace_id and v.channel_id = s.channel_id)
             as first_selected_at
      from private.admin_channel_states() s
      join public.channels c on c.workspace_id = s.workspace_id and c.id = s.channel_id
     where s.state <> 'paused'
       and c.catalogued_at is not null
       and exists (select 1 from public.video_selections v
                    where v.workspace_id = s.workspace_id and v.channel_id = s.channel_id)
  ),
  judged as (
    select last_ok_at,
           case
             when last_ok_at is not null then last_ok_at < now() - interval '48 hours'
             else first_selected_at < now() - interval '48 hours'
           end as stale
      from collected
  )
  select jsonb_build_object(
    'collected', (select count(*) from judged),
    'stale', (select count(*) from judged where stale),
    'never', (select count(*) from judged where stale and last_ok_at is null))
$$;

revoke all on function public.svc_monitor_channel_freshness() from public, anon, authenticated;
grant execute on function public.svc_monitor_channel_freshness() to service_role;
