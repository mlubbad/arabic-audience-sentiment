-- Selection becomes a table. Collection has been whole-channel: one job walks
-- every upload, and the owner never sees what exists, what it will cost, or
-- which videos are worth the quota. The catalogue (this file) is what the
-- source says exists; the selection is what the tenant asked for. Different
-- writers, different tables.

alter table public.videos
  add column reported_comment_count integer check (reported_comment_count >= 0),
  add column thumbnail_url text,
  -- Learned from the source: statistics.commentCount is absent when comments
  -- are switched off, "0" when they are on and nobody has written one.
  add column comments_state text not null default 'unknown'
    check (comments_state in ('unknown','open','disabled')),
  add column catalogued_at timestamptz;

alter table public.channels add column catalogued_at timestamptz;

-- The view the browser reads channels through, rebuilt from 20260915080000
-- with the new column appended (a replace may add trailing columns).
create or replace view public.connection_status
  with (security_invoker = true) as
  select c.workspace_id, c.id as channel_id, c.external_channel_id, c.handle,
         c.status, c.active_analysis_key, c.title, c.catalogued_at
  from public.channels c;

create table public.video_selections (
  workspace_id uuid not null,
  channel_id uuid not null,
  video_id uuid not null,
  selected_by uuid references auth.users(id),
  selected_at timestamptz not null default now(),
  -- Due when <= now(). A fresh selection is due at once.
  next_check_at timestamptz not null default now(),
  last_collected_at timestamptz,
  last_outcome text check (last_outcome is null or length(last_outcome) between 1 and 80),
  primary key (workspace_id, video_id),
  foreign key (workspace_id, video_id) references public.videos(workspace_id, id),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id, id)
);
create index video_selections_due
  on public.video_selections(workspace_id, channel_id, next_check_at);

alter table public.video_selections enable row level security;
revoke all on public.video_selections from anon, authenticated;
grant select on public.video_selections to authenticated;
create policy tenant_read on public.video_selections for select to authenticated
  using (private.has_role(workspace_id));
grant all on public.video_selections to service_role;

-- How often a live video is re-read, and how often the catalogue is rebuilt.
alter table public.plans
  add column live_interval_minutes integer not null default 1440
    check (live_interval_minutes >= 0),
  add column catalogue_interval_minutes integer not null default 1440
    check (catalogue_interval_minutes >= 0);

-- plan_limit, rebuilt from 20260913160000 (20260913190000 only changed its
-- grants) with the two new names added.
create or replace function private.plan_limit(w uuid, which text) returns integer
language sql stable security definer set search_path='' as $$
  select case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'sync_interval' then p.min_sync_interval_minutes
           when 'live_interval' then p.live_interval_minutes
           when 'catalogue_interval' then p.catalogue_interval_minutes
         end
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.workspace_id = w and s.status = 'active';
$$;
revoke all on function private.plan_limit(uuid,text) from public, anon, authenticated;

-- Every video that already has comments was collected under the old rule and
-- stays live under the new one, so the pilot channel's behaviour continues.
insert into public.video_selections(workspace_id, channel_id, video_id, selected_by, last_collected_at, last_outcome)
select v.workspace_id, v.channel_id, v.id, w.created_by, max(c.last_seen_at), 'exhausted'
  from public.videos v
  join public.workspaces w on w.id = v.workspace_id
  join public.comments c on c.workspace_id = v.workspace_id and c.video_id = v.id
 group by v.workspace_id, v.channel_id, v.id, w.created_by
on conflict do nothing;

update public.videos v set comments_state = 'open'
 where exists (select 1 from public.comments c
                where c.workspace_id = v.workspace_id and c.video_id = v.id);

-- What a collect job should read: selected, not switched off, due. The server
-- decides; the worker is handed the list and cannot widen it.
create function private.due_videos(w uuid, c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('video_id', v.id, 'external_video_id', v.external_video_id,
                              'title', v.title)
           order by s.next_check_at, v.id), '[]'::jsonb)
    from public.video_selections s
    join public.videos v on v.workspace_id = s.workspace_id and v.id = s.video_id
   where s.workspace_id = w and s.channel_id = c
     and s.next_check_at <= now()
     and v.comments_state <> 'disabled';
$$;
revoke all on function private.due_videos(uuid,uuid) from public, anon, authenticated;
grant execute on function private.due_videos(uuid,uuid) to service_role;

-- The twin of jobs_one_outstanding_collect.
create unique index jobs_one_outstanding_discover
    on public.jobs (workspace_id, channel_id)
 where type = 'discover' and status in ('queued', 'running');
