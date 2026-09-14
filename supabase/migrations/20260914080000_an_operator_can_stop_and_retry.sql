-- Monitoring without control is a spectator sport. A workspace could ask for a
-- collection and then watch it fail, with no way to try again and no way to
-- withdraw one that was queued by mistake — and because a channel admits one
-- outstanding collection at a time, a queued job nobody wanted blocked every
-- later request until a worker happened to consume it.
--
-- Two actions, both refusing a job that is running. A leased job belongs to the
-- worker holding it: cancelling underneath that worker would let it commit to a
-- job the tenant believes is stopped, and the lease is what makes a finished
-- job unwritable.

create function private.cancel_job_impl(w uuid, j uuid) returns void
language plpgsql security definer set search_path='' as $$
declare current text; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  select status into current from public.jobs where workspace_id=w and id=j;
  if not found then raise exception 'unknown_job' using errcode='42704'; end if;
  -- Only work that has not started. A finished job is history, and history is
  -- not cancellable.
  if current <> 'queued' then
    raise exception 'job_not_cancellable' using errcode='53400'; end if;
  update public.jobs set status='cancelled', error_code='cancelled_by_operator'
   where workspace_id=w and id=j;
end $$;

create function private.retry_job_impl(w uuid, j uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare current record; fresh uuid; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  select status, channel_id, type, checkpoint into current
    from public.jobs where workspace_id=w and id=j;
  if not found then raise exception 'unknown_job' using errcode='42704'; end if;
  if current.status not in ('failed','blocked','cancelled','partial') then
    raise exception 'job_not_retryable' using errcode='53400'; end if;

  -- A new job rather than a reset one. The attempt that failed is part of the
  -- record: rewinding it would erase the evidence of what went wrong, which is
  -- exactly what somebody investigating a retry needs.
  --
  -- The checkpoint carries over, so a backfill that stopped halfway resumes
  -- instead of re-reading the channel from its first video.
  insert into public.jobs(workspace_id, channel_id, type, dedupe_key, checkpoint)
  values (w, current.channel_id, current.type,
          'retry:' || j::text || ':' || extract(epoch from now())::bigint::text,
          current.checkpoint)
  returning id into fresh;
  return fresh;
end $$;

create function public.cancel_job(w uuid, j uuid) returns void
language sql security invoker set search_path='' as $$select private.cancel_job_impl(w,j)$$;
create function public.retry_job(w uuid, j uuid) returns uuid
language sql security invoker set search_path='' as $$select private.retry_job_impl(w,j)$$;

revoke all on function private.cancel_job_impl(uuid,uuid), private.retry_job_impl(uuid,uuid),
  public.cancel_job(uuid,uuid), public.retry_job(uuid,uuid) from public, anon, authenticated;
grant execute on function private.cancel_job_impl(uuid,uuid), private.retry_job_impl(uuid,uuid),
  public.cancel_job(uuid,uuid), public.retry_job(uuid,uuid) to authenticated;
