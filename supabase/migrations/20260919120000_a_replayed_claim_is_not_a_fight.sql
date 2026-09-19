-- A replayed claim is not a fight, and a claim for one kind of work is not a
-- claim for every kind.
--
-- Two faults, both witnessed on 2026-09-19, share one root: `claim_job` reads
-- more out of the world than the world had said.
--
-- The first. Supabase replays an edge-function invocation whose response was
-- lost, and during a platform incident those replays arrive minutes apart.
-- Each one re-claimed a collect job whose lease had lapsed in between, and
-- every re-claim counted as a `reclaim` — twenty of them, from a worker that
-- never existed. The next claim would have buried the job as
-- `lease_thrashing:20`. A lease that lapsed with no heartbeat against it is
-- evidence of nobody, not of two workers fighting: the only holder it ever had
-- never proved it was alive. `heartbeats` is the discriminator. A lapsed lease
-- with `heartbeats = 0` is a silent resumption — no count, no backoff. A lease
-- that was heartbeated and then lapsed means a live worker was really
-- disturbed; that counts, backs off, and at twenty still buries the job.
--
-- The second. `run_backfill` claimed whatever job was oldest and ran it as a
-- collection, so an operator's one-shot run consumed a queued `analyse` job
-- and finished it «succeeded» having classified nothing. A worker that can
-- only run one kind of work must ask for that kind. `job_types` scopes the
-- claim; null stays unscoped, which is what a worker able to run everything
-- still wants.
--
-- Every create or replace below is a whole-body rewrite from the function's
-- current definition (the file named at each), with only the named change.

-- 1. The column. The number of heartbeats the current lease has received.
-- Reset to zero on every claim; a claim hands out a lease nobody has spoken
-- on yet.
alter table public.jobs add column heartbeats integer not null default 0;
comment on column public.jobs.heartbeats is
  'How many heartbeats the current lease has received. Zero means the holder '
  'never proved it was alive, so a lapsed lease is resumable without penalty.';

-- 2. The heartbeat, rebuilt from 20260912185902:349 with two changes. It
-- counts, and it no longer shortens the lease: the claim grants five minutes
-- and a heartbeat that fired early used to cut that to sixty seconds, so a
-- fast first batch followed by a slow one lost the lease mid-run. The renewal
-- is now a floor, never a reduction.
create or replace function private.heartbeat(j uuid, t uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.jobs
     set heartbeats = heartbeats + 1,
         lease_expires_at = greatest(lease_expires_at, now() + interval '5 minutes')
   where id = j and lease_token = t and status = 'running' and lease_expires_at > now();
  if not found then raise exception 'lease_lost' using errcode='40001'; end if;
end $$;

-- 3. The one-workspace claim keeps its signature and delegates. Existing
-- callers (the gateway's single-argument RPC, every test double) keep working.
create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
begin
  return query select * from private.claim_job(w, null::text[]);
end $$;

-- 4. The claim, rebuilt from 20260918130000:97 with the two named changes.
create or replace function private.claim_job(w uuid, job_types text[])
returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  if w is null then
    insert into public.worker_seen(workspace_id, last_seen_at)
    select ws.id, now() from public.workspaces ws
    on conflict (workspace_id) do update set last_seen_at = now();
  else
    insert into public.worker_seen(workspace_id, last_seen_at)
    values (w, now())
    on conflict (workspace_id) do update set last_seen_at = now();
  end if;

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where (w is null or workspace_id = w)
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      -- A reclaim counts only a lease whose holder proved alive and then went
      -- silent. A replayed request, or a worker that died before its first
      -- batch, resumes the job without penalty: nobody was fighting.
      reclaims = j.reclaims + case
        when j.status = 'running' and j.heartbeats > 0 then 1 else 0 end,
      not_before = case
        when j.status = 'running' and j.heartbeats > 0 and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      heartbeats = 0,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where (w is null or q.workspace_id = w)
        -- Null or empty means no preference: the caller runs whatever it
        -- claimed. A scoped caller is never handed work it cannot run.
        and (job_types is null or cardinality(job_types) = 0
             or q.type = any(job_types))
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by q.not_before, q.id
      for update skip locked limit 1)
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id,
          case when claimed.type in ('discover','collect','analyse','import')
               then claimed.type else 'collect' end,
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;
grant execute on function private.claim_job(uuid), private.claim_job(uuid, text[])
  to service_role;

-- 5. The gateway door, beside its single-argument self.
create function public.svc_worker_claim(token_hash text, job_types text[])
returns setof public.jobs language sql security invoker set search_path='' as $$
  select * from private.claim_job(private.worker_workspace(token_hash), job_types)
$$;
revoke all on function public.svc_worker_claim(text, text[]) from public, anon, authenticated;
grant execute on function public.svc_worker_claim(text, text[]) to service_role;
