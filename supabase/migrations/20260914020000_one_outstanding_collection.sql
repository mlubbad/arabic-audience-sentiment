-- Two clicks on «طلب مزامنة» produced two jobs, and a third would have made a
-- third. The dedupe key was guarding the wrong thing: it makes a *replay* of
-- one request idempotent, and the browser minted a fresh key on every click,
-- so by the key's own definition each click was a new request.
--
-- The invariant this product actually has is narrower than "no replays": a
-- channel has at most one collection outstanding. A second request while one
-- is still waiting is not a second job — it is the same intention expressed
-- twice, and the honest answer is the job that is already there.
--
-- Enforced by an index as well as inside the function, because a disabled
-- button proves nothing about a request sent directly.

-- Anything already queued twice is reconciled before the rule can apply to it.
-- The oldest survives: it is the one the operator has been waiting on.
with ranked as (
  select id, row_number() over (
           partition by workspace_id, channel_id order by created_at, id) as n
    from public.jobs
   where type = 'collect' and status in ('queued', 'running'))
update public.jobs set status = 'cancelled', error_code = 'superseded_by_existing_request'
 where id in (select id from ranked where n > 1);

create unique index jobs_one_outstanding_collect
    on public.jobs (workspace_id, channel_id)
 where type = 'collect' and status in ('queued', 'running');

create or replace function private.enqueue_sync_impl(w uuid, c uuid, k text)
returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid; gap int; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;

  -- An idempotent replay is not a new request, so it is answered before the
  -- rate limit rather than being refused for arriving twice.
  select id into j from public.jobs
   where workspace_id=w and dedupe_key=k and channel_id=c and type='collect';
  if j is not null then return j; end if;

  -- Already waiting, or being worked on. That job is the answer; a second one
  -- would collect the same comments twice and say nothing new.
  select id into j from public.jobs
   where workspace_id=w and channel_id=c and type='collect'
     and status in ('queued','running') order by created_at limit 1;
  if j is not null then return j; end if;

  gap := private.plan_limit(w,'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type='collect'
         and created_at > now() - make_interval(mins => gap)) then
    raise exception 'sync_too_soon' using errcode='53400'; end if;

  begin
    insert into public.jobs(workspace_id,channel_id,type,dedupe_key)
    values (w,c,'collect',k) returning id into j;
  exception when unique_violation then
    -- Two requests raced past the checks above. Whichever index refused this
    -- one, the row that won is the answer to both.
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='collect'
       and status in ('queued','running') order by created_at limit 1;
    if j is null then
      select id into j from public.jobs where workspace_id=w and dedupe_key=k; end if;
    if j is null then raise; end if;
  end;
  return j;
end $$;
