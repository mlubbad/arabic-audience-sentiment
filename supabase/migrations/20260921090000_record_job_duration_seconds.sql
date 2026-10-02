-- 20260921090000_record_job_duration_seconds.sql
-- Ensure every finished job records elapsed duration_seconds in counters.

create or replace function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare
  w uuid;
  ch uuid;
  start_time timestamptz;
  dur_sec integer;
begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;

  select created_at into start_time from public.jobs where id = j;
  dur_sec := greatest(1, round(extract(epoch from (now() - coalesce(start_time, now())))))::int;

  update public.jobs set status = outcome,
    error_code = case when outcome = 'succeeded' then null else reason end,
    last_error = case
      when outcome = 'succeeded' then null
      else coalesce(reason, public.jobs.last_error) end,
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
          case when outcome = 'succeeded' then null else reason end)
  on conflict (workspace_id, job_id) do update
    set status = excluded.status,
        ended_at = excluded.ended_at,
        error_code = excluded.error_code;
end $$;

grant execute on function private.worker_finish(text,uuid,uuid,text,text)
  to service_role;

-- Backfill duration_seconds for any existing completed jobs using sync_runs or duration between timestamps
update public.jobs j
set counters = jsonb_set(
  coalesce(j.counters, '{}'::jsonb),
  '{duration_seconds}',
  to_jsonb(greatest(1, round(extract(epoch from (coalesce(s.ended_at, now()) - coalesce(s.started_at, j.created_at)))))::int)
)
from public.sync_runs s
where s.job_id = j.id and s.ended_at is not null;
