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
insert into private.audience_drain_state(singleton) values (true);
alter table private.audience_member_videos enable row level security;
alter table private.audience_members enable row level security;
alter table private.audience_drain_state enable row level security;
revoke all on table private.audience_member_videos, private.audience_members, private.audience_drain_state from public, anon, authenticated;
grant all on table private.audience_member_videos, private.audience_members, private.audience_drain_state to service_role;

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
begin
  if not private.switch_on('audience_overlap') then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('audience_members_drain', 0)) then return 0; end if;
  select last_seen_at, last_id into cursor_at, cursor_id from private.audience_drain_state where singleton;
  for target in
    with picked as (
      select c.workspace_id, c.video_id, c.last_seen_at, c.id
        from public.comments c
       where c.content_purged_at is null
         and (cursor_at is null or (c.last_seen_at, c.id) > (cursor_at, cursor_id))
       order by c.last_seen_at, c.id limit greatest(max_comments, 0)
    )
    select p.workspace_id, p.video_id, min(p.last_seen_at) first_at,
           (array_agg(p.id order by p.last_seen_at, p.id))[1] first_id
      from picked p group by p.workspace_id, p.video_id
     order by min(p.last_seen_at), (array_agg(p.id order by p.last_seen_at, p.id))[1]
  loop
    exit when clock_timestamp() - started > budget;
    begin
      select ch.external_channel_id into owner_id
        from public.videos v join public.channels ch
          on ch.workspace_id=v.workspace_id and ch.id=v.channel_id
       where v.workspace_id=target.workspace_id and v.id=target.video_id;
      if found then
        delete from private.audience_member_videos
         where workspace_id=target.workspace_id and video_id=target.video_id;
        insert into private.audience_member_videos(workspace_id,video_id,member_hash,comment_count,last_seen_at)
        select c.workspace_id, c.video_id,
               extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), private.audience_pepper(), 'sha256'),
               count(*)::int, max(c.last_seen_at)
          from public.comments c join public.videos v
            on v.workspace_id=c.workspace_id and v.id=c.video_id
         where c.workspace_id=target.workspace_id and c.video_id=target.video_id
           and c.content_purged_at is null and c.author_channel_id is not null
           and c.author_channel_id <> owner_id
         group by c.workspace_id,c.video_id,
                  extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), private.audience_pepper(), 'sha256');
        delete from private.audience_members m
         where m.workspace_id=target.workspace_id
           and m.channel_id=(select v.channel_id from public.videos v where v.workspace_id=target.workspace_id and v.id=target.video_id);
        insert into private.audience_members(workspace_id,channel_id,member_hash,first_seen_at,last_seen_at,comment_count)
        with video_ranges as (
          select c.workspace_id,c.video_id,
                 extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), private.audience_pepper(), 'sha256') member_hash,
                 min(c.first_seen_at) first_seen_at
            from public.comments c
           where c.content_purged_at is null and c.author_channel_id is not null
           group by c.workspace_id,c.video_id,
                    extensions.hmac(convert_to(c.platform || ':' || c.author_channel_id, 'UTF8'), private.audience_pepper(), 'sha256')
        )
        select v.workspace_id,v.channel_id,amv.member_hash,min(r.first_seen_at),max(amv.last_seen_at),sum(amv.comment_count)::int
          from private.audience_member_videos amv
          join public.videos v on v.workspace_id=amv.workspace_id and v.id=amv.video_id
          join video_ranges r on r.workspace_id=amv.workspace_id and r.video_id=amv.video_id and r.member_hash=amv.member_hash
         where v.workspace_id=target.workspace_id
           and v.channel_id=(select v2.channel_id from public.videos v2 where v2.workspace_id=target.workspace_id and v2.id=target.video_id)
         group by v.workspace_id,v.channel_id,amv.member_hash;
      end if;
      -- Advance conservatively: another video's comments may interleave with
      -- this video's later rows, so the watermark stops at the first row.
      update private.audience_drain_state set last_seen_at=target.first_at,last_id=target.first_id where singleton;
      cursor_at := target.first_at; cursor_id := target.first_id;
      done := done + 1;
    exception when others then
      raise warning 'audience_members drain failed for video %', target.video_id;
      exit;
    end;
  end loop;
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
  select w.id,uid,('audience' || '_pepper' || '_rotated'),'platform',('audience' || '_pepper')
    from public.workspaces w limit 1;
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
