insert into private.platform_switches(key, enabled)
values ('audience_overlap', false)
on conflict (key) do nothing;

do $vault$
begin
  if to_regnamespace('vault') is null then
    raise notice 'vault is not available; audience pepper must be provisioned before enabling overlap';
  elsif not exists (select 1 from vault.secrets where name = 'audience_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'audience_pepper', 'Audience identity HMAC pepper');
  end if;
end;
$vault$;

create function private.audience_pepper() returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare value text;
begin
  select decrypted_secret into value from vault.decrypted_secrets where name = 'audience_pepper';
  if value is null then raise exception 'pepper_missing' using errcode = 'P0001'; end if;
  return decode(value, 'hex');
end;
$$;
revoke all on function private.audience_pepper() from public, anon, authenticated;
grant execute on function private.audience_pepper() to service_role;

create table private.audience_member_videos (
  workspace_id uuid not null,
  video_id uuid not null,
  member_hash bytea not null,
  comment_count int not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (workspace_id, video_id, member_hash),
  foreign key (workspace_id, video_id) references public.videos(workspace_id, id) on delete cascade
);
create table private.audience_members (
  workspace_id uuid not null,
  channel_id uuid not null,
  member_hash bytea not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  comment_count int not null,
  is_suspected_bot boolean not null default false,
  primary key (workspace_id, channel_id, member_hash),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id, id) on delete cascade
);
create table private.audience_drain_state (
  singleton boolean primary key default true check (singleton),
  last_seen_at timestamptz,
  last_id uuid
);
create table private.audience_drain_failures (
  workspace_id uuid not null,
  video_id uuid not null,
  sqlstate text not null,
  failed_at timestamptz not null default now(),
  primary key (workspace_id, video_id),
  foreign key (workspace_id, video_id) references public.videos(workspace_id, id) on delete cascade
);
insert into private.audience_drain_state(singleton) values (true);
alter table private.audience_member_videos enable row level security;
alter table private.audience_members enable row level security;
alter table private.audience_drain_state enable row level security;
alter table private.audience_drain_failures enable row level security;
revoke all on table private.audience_member_videos, private.audience_members, private.audience_drain_state, private.audience_drain_failures from public, anon, authenticated;
grant all on table private.audience_member_videos, private.audience_members, private.audience_drain_state, private.audience_drain_failures to service_role;

create function private.drain_audience_members(
  max_comments int default 20000,
  budget interval default interval '60 seconds'
) returns int language plpgsql security definer set search_path = '' as $$
declare
  target record;
  cursor_at timestamptz;
  cursor_id uuid;
  done int := 0;
  started timestamptz := clock_timestamp();
  owner_id text;
  pepper bytea;
  old_hashes bytea[];
  channel uuid;
  failure_state text;
  first_unprocessed record;
begin
  if not private.switch_on('audience_overlap') then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('audience_members_drain', 0)) then return 0; end if;
  pepper := private.audience_pepper();
  select last_seen_at, last_id into cursor_at, cursor_id from private.audience_drain_state where singleton;
  create temporary table if not exists audience_drain_picked (
    workspace_id uuid not null, video_id uuid not null, last_seen_at timestamptz not null,
    id uuid not null, processed boolean not null default false
  ) on commit drop;
  truncate pg_temp.audience_drain_picked;
  insert into pg_temp.audience_drain_picked(workspace_id,video_id,last_seen_at,id)
  select c.workspace_id,c.video_id,c.last_seen_at,c.id
    from public.comments c
   where c.content_purged_at is null
     and (cursor_at is null or (c.last_seen_at,c.id) > (cursor_at,cursor_id))
   order by c.last_seen_at,c.id limit greatest(max_comments,0);
  for target in
    select f.workspace_id,f.video_id,true retry,min(p.last_seen_at) first_at,
           (array_agg(p.id order by p.last_seen_at,p.id))[1] first_id
      from private.audience_drain_failures f
      left join pg_temp.audience_drain_picked p using (workspace_id,video_id)
     group by f.workspace_id,f.video_id
    union all
    select p.workspace_id,p.video_id,false,min(p.last_seen_at),
           (array_agg(p.id order by p.last_seen_at,p.id))[1]
      from pg_temp.audience_drain_picked p
     where not exists (select 1 from private.audience_drain_failures f where f.workspace_id=p.workspace_id and f.video_id=p.video_id)
     group by p.workspace_id,p.video_id
     order by 3 desc,4 nulls last,5
  loop
    exit when clock_timestamp() - started > budget;
    begin
      select ch.external_channel_id into owner_id
        from public.videos v join public.channels ch
          on ch.workspace_id=v.workspace_id and ch.id=v.channel_id
       where v.workspace_id=target.workspace_id and v.id=target.video_id;
      if found then
        channel := (select v.channel_id from public.videos v where v.workspace_id=target.workspace_id and v.id=target.video_id);
        select array_agg(member_hash) into old_hashes from private.audience_member_videos
         where workspace_id=target.workspace_id and video_id=target.video_id;
        delete from private.audience_member_videos
         where workspace_id=target.workspace_id and video_id=target.video_id;
        insert into private.audience_member_videos(workspace_id,video_id,member_hash,comment_count,first_seen_at,last_seen_at)
        select c.workspace_id, c.video_id,
               extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), pepper, 'sha256'),
               count(*)::int, min(c.first_seen_at), max(c.last_seen_at)
          from public.comments c join public.videos v
            on v.workspace_id=c.workspace_id and v.id=c.video_id
         where c.workspace_id=target.workspace_id and c.video_id=target.video_id
           and c.content_purged_at is null and c.author_channel_id is not null
           and c.author_channel_id is distinct from owner_id
         group by c.workspace_id,c.video_id,
                  extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), pepper, 'sha256');
        delete from private.audience_members m
         where m.workspace_id=target.workspace_id
           and m.channel_id=channel
           and (m.member_hash=any(coalesce(old_hashes,'{}'::bytea[])) or exists (
             select 1 from private.audience_member_videos amv where amv.workspace_id=target.workspace_id
               and amv.video_id=target.video_id and amv.member_hash=m.member_hash));
        insert into private.audience_members(workspace_id,channel_id,member_hash,first_seen_at,last_seen_at,comment_count)
        select v.workspace_id,v.channel_id,amv.member_hash,min(amv.first_seen_at),max(amv.last_seen_at),sum(amv.comment_count)::int
          from private.audience_member_videos amv
          join public.videos v on v.workspace_id=amv.workspace_id and v.id=amv.video_id
         where v.workspace_id=target.workspace_id
           and v.channel_id=channel
           and (amv.member_hash=any(coalesce(old_hashes,'{}'::bytea[])) or amv.member_hash in (
             select amv2.member_hash from private.audience_member_videos amv2 where amv2.workspace_id=target.workspace_id and amv2.video_id=target.video_id))
         group by v.workspace_id,v.channel_id,amv.member_hash;
      end if;
      delete from private.audience_drain_failures where workspace_id=target.workspace_id and video_id=target.video_id;
      update pg_temp.audience_drain_picked set processed=true where workspace_id=target.workspace_id and video_id=target.video_id;
      done := done + 1;
    exception when others then
      failure_state := sqlstate;
      insert into private.audience_drain_failures(workspace_id,video_id,sqlstate)
      values(target.workspace_id,target.video_id,failure_state) on conflict(workspace_id,video_id)
      do update set sqlstate=excluded.sqlstate,failed_at=now();
      update pg_temp.audience_drain_picked set processed=true where workspace_id=target.workspace_id and video_id=target.video_id;
      raise warning 'audience_members drain failed for video % (SQLSTATE %)', target.video_id, failure_state;
    end;
  end loop;
  select p.last_seen_at,p.id into first_unprocessed
    from pg_temp.audience_drain_picked p
   where not p.processed
   order by p.last_seen_at,p.id limit 1;
  if found then
    update private.audience_drain_state s set (last_seen_at,last_id) = (
      select p.last_seen_at,p.id from pg_temp.audience_drain_picked p
       where (p.last_seen_at,p.id) < (first_unprocessed.last_seen_at,first_unprocessed.id)
       order by p.last_seen_at desc,p.id desc limit 1
    ) where singleton and exists (select 1 from pg_temp.audience_drain_picked p
      where (p.last_seen_at,p.id) < (first_unprocessed.last_seen_at,first_unprocessed.id));
  else
    update private.audience_drain_state s set (last_seen_at,last_id) = (
      select p.last_seen_at,p.id from pg_temp.audience_drain_picked p order by p.last_seen_at desc,p.id desc limit 1
    ) where singleton and exists(select 1 from pg_temp.audience_drain_picked);
  end if;
  return done;
end;
$$;
revoke all on function private.drain_audience_members(int,interval) from public, anon, authenticated;
grant execute on function private.drain_audience_members(int,interval) to service_role;

create or replace function private.purge_comment_text(retain interval default interval '30 days')
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if retain < interval '0' then raise exception 'invalid_input' using errcode='22023'; end if;
  update public.comments set
    text_raw = null, text_plain = null, author_name = null, author_channel_id = null,
    likes_raw = null, content_purged_at = now()
  where content_purged_at is null and last_seen_at < now() - retain;
  get diagnostics removed = row_count;
  delete from private.audience_member_videos where last_seen_at < now() - retain;
  delete from private.audience_members where last_seen_at < now() - retain;
  return removed;
end $$;
revoke all on function private.purge_comment_text(interval) from public, anon, authenticated;
grant execute on function private.purge_comment_text(interval) to service_role;

create function public.admin_rotate_audience_pepper() returns void
language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; uid uuid := auth.uid();
begin
  if uid is null or not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if to_regnamespace('vault') is null then raise exception 'pepper_missing' using errcode='P0001'; end if;
  select id into secret_id from vault.secrets where name='audience_pepper';
  if secret_id is null then raise exception 'pepper_missing' using errcode='P0001'; end if;
  perform vault.update_secret(secret_id, encode(extensions.gen_random_bytes(32), 'hex'), 'audience_pepper', 'Audience identity HMAC pepper');
  truncate table private.audience_member_videos, private.audience_members;
  update private.audience_drain_state set last_seen_at=null,last_id=null where singleton;
  insert into public.audit_events(workspace_id,actor_id,action,target_type,target_id)
  values(null,uid,'audience_pepper_rotated','platform','audience_pepper');
end;
$$;
revoke all on function public.admin_rotate_audience_pepper() from public, anon;
grant execute on function public.admin_rotate_audience_pepper() to authenticated;

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name='pg_cron') then
    raise notice 'pg_cron is not available; skipping the audience members drain'; return;
  end if;
  create extension if not exists pg_cron with schema extensions;
  perform cron.unschedule(jobid) from cron.job where jobname='audience-members-drain';
  perform cron.schedule('audience-members-drain','*/10 * * * *',
    $job$set local statement_timeout = '5min'; select private.drain_audience_members()$job$);
end;
$schedule$;
