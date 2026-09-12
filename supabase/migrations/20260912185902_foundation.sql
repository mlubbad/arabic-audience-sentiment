-- M2 foundation. Apply only to a fresh, explicitly selected development database.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 timezone text not null default 'Asia/Istanbul', created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.memberships (
 workspace_id uuid not null references public.workspaces(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('workspace_owner','analyst','viewer')), primary key(workspace_id,user_id)
);
create index memberships_user on public.memberships(user_id,workspace_id);
create table public.clients (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 120), unique(workspace_id,id)
);
create table public.channels (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, client_id uuid not null,
 platform text not null default 'youtube' check(platform='youtube'), external_channel_id text not null,
 handle text, status text not null default 'public_unverified' check(status in ('public_unverified','connected','reconnect_required','disconnected')),
 active_analysis_key text, unique(workspace_id,id),unique(workspace_id,platform,external_channel_id),
 foreign key(workspace_id,client_id) references public.clients(workspace_id,id)
);
create table public.videos (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, channel_id uuid not null,
 platform text not null default 'youtube' check(platform='youtube'),external_video_id text not null,title text not null,
 kind text not null default 'video' check(kind in ('video','short','stream')),published_at timestamptz,duration_sec integer check(duration_sec>=0),
 last_observed_at timestamptz not null default now(),field_provenance jsonb not null default '{}',
 unique(workspace_id,id),unique(workspace_id,platform,external_video_id),
 foreign key(workspace_id,channel_id) references public.channels(workspace_id,id)
);
create index videos_channel on public.videos(workspace_id,channel_id);
create table public.comments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,video_id uuid not null,
 platform text not null default 'youtube' check(platform='youtube'),external_comment_id text not null,external_parent_id text,
 is_reply boolean not null default false,parent_source text not null default 'unknown' check(parent_source in ('api','extractor','inferred_id','unknown')),
 author_channel_id text,author_name text,text_raw text not null,text_plain text not null,content_hash text not null,
 published_time_raw text,published_at timestamptz,timestamp_precision text not null check(timestamp_precision in ('second','minute','day','approximate','unknown')),
 likes_raw text,likes_value bigint check(likes_value>=0),source text not null,field_provenance jsonb not null default '{}',
 first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,platform,external_comment_id),
 foreign key(workspace_id,video_id) references public.videos(workspace_id,id)
);
create index comments_video_date on public.comments(workspace_id,video_id,published_at,id);
create table public.analysis_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),model_id text not null,
 revision_sha text not null,preprocessing_version text not null,parameters jsonb not null default '{}',
 started_at timestamptz not null default now(),status text not null check(status in ('running','succeeded','failed')),unique(workspace_id,id)
);
create table public.sentiment_predictions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,comment_id uuid not null,content_hash text not null,
 analysis_run_id uuid not null,analysis_key text not null,status text not null check(status in ('succeeded','skipped','failed','unsupported')),
 label text check(label in ('positive','negative','neutral','mixed')),class_scores jsonb not null default '{}',predicted_at timestamptz not null default now(),
 check((status='succeeded')=(label is not null)),unique(workspace_id,comment_id,content_hash,analysis_key),
 foreign key(workspace_id,comment_id) references public.comments(workspace_id,id),
 foreign key(workspace_id,analysis_run_id) references public.analysis_runs(workspace_id,id)
);
create table public.comment_reviews (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,comment_id uuid not null,content_hash text not null,
 label text not null check(label in ('positive','negative','neutral','mixed')),reviewer_id uuid not null references auth.users(id),
 reason text not null,origin text not null default 'human' check(origin in ('human','legacy_unverified')),created_at timestamptz not null default now(),
 foreign key(workspace_id,comment_id) references public.comments(workspace_id,id)
);
create table public.jobs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,channel_id uuid not null,
 type text not null check(type in ('discover','collect','analyse','import','export')),dedupe_key text not null check(length(dedupe_key) between 1 and 200),
 status text not null default 'queued' check(status in ('queued','running','succeeded','partial','failed','blocked','cancelled')),
 attempt integer not null default 0 check(attempt>=0),not_before timestamptz not null default now(),
 lease_token uuid,lease_expires_at timestamptz,checkpoint jsonb not null default '{}',counters jsonb not null default '{}',error_code text,
 created_at timestamptz not null default now(),unique(workspace_id,dedupe_key),unique(workspace_id,id),
 foreign key(workspace_id,channel_id) references public.channels(workspace_id,id)
);
create index jobs_claim on public.jobs(status,not_before);
create table private.job_batches (
 job_id uuid not null references public.jobs(id),batch_key text not null,checkpoint jsonb not null,primary key(job_id,batch_key)
);
create table private.oauth_connections (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,channel_id uuid not null,
 connected_by uuid not null references auth.users(id),encrypted_tokens bytea not null,key_version text not null,
 granted_scopes text[] not null,expires_at timestamptz,status text not null,
 foreign key(workspace_id,channel_id) references public.channels(workspace_id,id)
);
create table private.oauth_states (
 state_hash text primary key,user_id uuid not null references auth.users(id),workspace_id uuid not null,client_id uuid not null,
 expires_at timestamptz not null,consumed_at timestamptz,
 foreign key(workspace_id,client_id) references public.clients(workspace_id,id)
);

-- Non-exposed membership helper checks the current authenticated caller, never user metadata.
create function private.has_role(w uuid, allowed text[] default array['workspace_owner','analyst','viewer'])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.memberships m
 where m.workspace_id=w and m.user_id=(select auth.uid()) and m.role=any(allowed));
$$;
revoke all on function private.has_role(uuid,text[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_role(uuid,text[]) to authenticated;

do $$ declare t text; begin
 foreach t in array array['workspaces','memberships','clients','channels','videos','comments','analysis_runs','sentiment_predictions','comment_reviews','jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 if t <> 'jobs' then execute format('grant select on public.%I to authenticated',t); end if;
 execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_role(%I))',t,case when t='workspaces' then 'id' else 'workspace_id' end);
 end loop;
end $$;
-- Lease tokens are not available through the tenant-facing table projection.
grant select(id,workspace_id,channel_id,type,dedupe_key,status,attempt,not_before,lease_expires_at,checkpoint,counters,error_code,created_at) on public.jobs to authenticated;
grant insert(workspace_id,name),update(name) on public.clients to authenticated;
create policy clients_insert on public.clients for insert to authenticated with check(private.has_role(workspace_id,array['workspace_owner']));
create policy clients_update on public.clients for update to authenticated using(private.has_role(workspace_id,array['workspace_owner'])) with check(private.has_role(workspace_id,array['workspace_owner']));
-- Private tables also deny browser access; only trusted server operations can access them.
alter table private.oauth_connections enable row level security;
alter table private.oauth_states enable row level security;
alter table private.job_batches enable row level security;
revoke all on all tables in schema private from public,anon,authenticated;

-- Definer implementations stay in a non-exposed schema; public wrappers use invoker security.
create function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 insert into public.workspaces(name,created_by) values(workspace_name,auth.uid()) returning id into w;
 insert into public.memberships values(w,auth.uid(),'workspace_owner'); return w;
end $$;
create function public.create_workspace(workspace_name text) returns uuid language sql security invoker set search_path='' as $$ select private.create_workspace_impl(workspace_name) $$;

create function private.enqueue_sync_impl(w uuid,c uuid,k text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j uuid; begin
 if not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.channels where workspace_id=w and id=c) then raise exception 'invalid_channel' using errcode='23503'; end if;
 insert into public.jobs(workspace_id,channel_id,type,dedupe_key) values(w,c,'collect',k)
 on conflict(workspace_id,dedupe_key) do nothing returning id into j;
 if j is null then
 select id into j from public.jobs where workspace_id=w and dedupe_key=k and channel_id=c and type='collect';
 if j is null then raise exception 'idempotency_conflict' using errcode='23505'; end if;
 end if; return j;
end $$;
create function public.enqueue_sync(w uuid,c uuid,k text) returns uuid language sql security invoker set search_path='' as $$select private.enqueue_sync_impl(w,c,k)$$;

-- Channel registration is role-checked and tenant-checked. A tenant may claim only a
-- syntactically valid public channel id, and never sets verification status itself:
-- 'connected' is reserved for a completed OAuth flow (M5), not a self-declared URL.
create function private.register_channel_impl(w uuid,c uuid,external text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ch uuid; begin
 if not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.clients where workspace_id=w and id=c) then raise exception 'invalid_client' using errcode='23503'; end if;
 if external !~ '^UC[A-Za-z0-9_-]{22}$' then raise exception 'invalid_channel_id' using errcode='22023'; end if;
 insert into public.channels(workspace_id,client_id,external_channel_id) values(w,c,external)
 on conflict(workspace_id,platform,external_channel_id) do nothing returning id into ch;
 if ch is null then
 select id into ch from public.channels where workspace_id=w and platform='youtube' and external_channel_id=external and client_id=c;
 if ch is null then raise exception 'channel_claimed_by_other_client' using errcode='23505'; end if;
 end if; return ch;
end $$;
create function public.register_channel(w uuid,c uuid,external text) returns uuid language sql security invoker set search_path='' as $$select private.register_channel_impl(w,c,external)$$;

-- Every Auth user gets one personal workspace, so no signed-in user is left without a tenant.
-- Runs as definer because the inserting session is GoTrue, not the new user.
create function private.bootstrap_personal_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 insert into public.workspaces(name,created_by) values('مساحة العمل الشخصية',new.id) returning id into w;
 insert into public.memberships values(w,new.id,'workspace_owner'); return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
 for each row execute function private.bootstrap_personal_workspace();

-- Service-only primitives. The future worker HTTP gateway must derive w from a scoped credential.
create function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
begin
 update public.jobs set status='failed',error_code='retry_exhausted',lease_token=null
 where workspace_id=w and attempt>=3 and status in ('queued','running') and (lease_expires_at is null or lease_expires_at<=now());
 return query update public.jobs j set status='running',attempt=j.attempt+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '60 seconds'
 where j.id=(select q.id from public.jobs q where q.workspace_id=w and q.attempt<3 and q.not_before<=now()
 and (q.status='queued' or (q.status='running' and q.lease_expires_at<=now()))
 order by q.not_before,q.id for update skip locked limit 1) returning j.*;
end $$;
create function private.commit_checkpoint(j uuid,t uuid,p jsonb,b text) returns void
language plpgsql security invoker set search_path='' as $$
declare old jsonb; begin
 perform 1 from public.jobs where id=j and lease_token=t and status='running' and lease_expires_at>now() for update;
 if not found then raise exception 'lease_lost' using errcode='40001'; end if;
 if jsonb_typeof(p)<>'object' or b is null or length(b) not between 1 and 200 then raise exception 'invalid_batch'; end if;
 select checkpoint into old from private.job_batches where job_id=j and batch_key=b;
 if found then
 if old<>p then raise exception 'batch_conflict'; end if; return;
 end if;
 insert into private.job_batches values(j,b,p);
 update public.jobs set checkpoint=p where id=j;
end $$;
create function private.heartbeat(j uuid,t uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.jobs set lease_expires_at=now()+interval '60 seconds' where id=j and lease_token=t and status='running' and lease_expires_at>now();
 if not found then raise exception 'lease_lost' using errcode='40001'; end if;
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_role(uuid,text[]),private.create_workspace_impl(text),private.enqueue_sync_impl(uuid,uuid,text),private.register_channel_impl(uuid,uuid,text) to authenticated;
revoke all on function public.create_workspace(text),public.enqueue_sync(uuid,uuid,text),public.register_channel(uuid,uuid,text) from public,anon;
grant execute on function public.create_workspace(text),public.enqueue_sync(uuid,uuid,text),public.register_channel(uuid,uuid,text) to authenticated;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
grant all on all tables in schema public to service_role;
grant execute on function private.claim_job(uuid),private.commit_checkpoint(uuid,uuid,jsonb,text),private.heartbeat(uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('imports','imports',false,10485760,array['text/csv','application/json','application/x-ndjson']),
 ('exports','exports',false,10485760,array['text/csv']);
create policy tenant_files_read on storage.objects for select to authenticated using (
 bucket_id in ('imports','exports') and exists(select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.workspace_id::text=split_part(name,'/',1))
);
create policy tenant_import_insert on storage.objects for insert to authenticated with check (
 bucket_id='imports' and exists(select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.role in ('workspace_owner','analyst') and m.workspace_id::text=split_part(name,'/',1))
);
