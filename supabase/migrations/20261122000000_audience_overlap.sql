alter table public.plans add column audience_overlap boolean not null default false;
alter table public.plans disable trigger plans_audited;
update public.plans set audience_overlap = key in ('agency','media','enterprise','owner');
alter table public.plans enable trigger plans_audited;

create function private.overlap_allowed(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.audience_overlap
      from public.subscriptions s
      join public.plans p on p.key = s.plan_key
     where s.workspace_id = private.billing_root(w)
       and s.status in ('active','past_due')
  ), false)
$$;
revoke all on function private.overlap_allowed(uuid) from public, anon, authenticated;
grant execute on function private.overlap_allowed(uuid) to service_role;

create table private.audience_sizes (
  workspace_id uuid not null,
  channel_id uuid not null,
  platform text not null,
  size int not null check (size >= 0),
  computed_at timestamptz not null,
  primary key (workspace_id, channel_id),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id, id) on delete cascade
);
create table private.audience_universe (
  workspace_id uuid not null,
  platform text not null,
  size int not null check (size >= 0),
  computed_at timestamptz not null,
  primary key (workspace_id, platform)
);
create table private.audience_overlap_cells (
  workspace_id uuid not null,
  channel_a uuid not null,
  channel_b uuid not null,
  a_size int not null check (a_size >= 0),
  b_size int not null check (b_size >= 0),
  shared int not null check (shared >= 0),
  computed_at timestamptz not null,
  primary key (workspace_id, channel_a, channel_b),
  check (channel_a < channel_b),
  foreign key (workspace_id, channel_a) references public.channels(workspace_id, id) on delete cascade,
  foreign key (workspace_id, channel_b) references public.channels(workspace_id, id) on delete cascade
);
create table private.audience_overlap_history (
  workspace_id uuid not null,
  channel_a uuid not null,
  channel_b uuid not null,
  day date not null,
  a_size int not null check (a_size >= 0),
  b_size int not null check (b_size >= 0),
  shared int not null check (shared >= 0),
  primary key (workspace_id, channel_a, channel_b, day),
  check (channel_a < channel_b)
);
alter table private.audience_sizes enable row level security;
alter table private.audience_universe enable row level security;
alter table private.audience_overlap_cells enable row level security;
alter table private.audience_overlap_history enable row level security;
revoke all on private.audience_sizes, private.audience_universe, private.audience_overlap_cells, private.audience_overlap_history from public, anon, authenticated;
grant all on private.audience_sizes, private.audience_universe, private.audience_overlap_cells, private.audience_overlap_history to service_role;

create function private.refresh_audience_overlap(budget interval default interval '2 minutes') returns int
language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
  started timestamptz := clock_timestamp();
  at_time timestamptz;
  changed int := 0;
  n int;
begin
  if not private.switch_on('audience_overlap') then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('audience_overlap_refresh', 0)) then return 0; end if;
  for w in
    select m.workspace_id
      from private.audience_members m
     group by m.workspace_id
     order by (select min(s.computed_at) from private.audience_sizes s where s.workspace_id=m.workspace_id) nulls first, m.workspace_id
  loop
    exit when clock_timestamp() - started >= budget;
    begin
      at_time := clock_timestamp();
      delete from private.audience_sizes where workspace_id=w;
      insert into private.audience_sizes(workspace_id,channel_id,platform,size,computed_at)
      select c.workspace_id,c.id,c.platform,count(m.member_hash)::int,at_time
        from public.channels c
        left join private.audience_members m on m.workspace_id=c.workspace_id and m.channel_id=c.id and not m.is_suspected_bot
       where c.workspace_id=w
       group by c.workspace_id,c.id,c.platform;
      delete from private.audience_universe where workspace_id=w;
      insert into private.audience_universe(workspace_id,platform,size,computed_at)
      select c.workspace_id,c.platform,count(distinct m.member_hash)::int,at_time
        from public.channels c
        left join private.audience_members m on m.workspace_id=c.workspace_id and m.channel_id=c.id and not m.is_suspected_bot
       where c.workspace_id=w
       group by c.workspace_id,c.platform;
      delete from private.audience_overlap_cells where workspace_id=w;
      insert into private.audience_overlap_cells(workspace_id,channel_a,channel_b,a_size,b_size,shared,computed_at)
      select w,a.channel_id,b.channel_id,sa.size,sb.size,count(*)::int,at_time
        from private.audience_members a
        join private.audience_members b on b.workspace_id=a.workspace_id and b.member_hash=a.member_hash and a.channel_id<b.channel_id
        join public.channels ca on ca.workspace_id=a.workspace_id and ca.id=a.channel_id
        join public.channels cb on cb.workspace_id=b.workspace_id and cb.id=b.channel_id and cb.platform=ca.platform
        join private.audience_sizes sa on sa.workspace_id=w and sa.channel_id=a.channel_id
        join private.audience_sizes sb on sb.workspace_id=w and sb.channel_id=b.channel_id
       where a.workspace_id=w and not a.is_suspected_bot and not b.is_suspected_bot
       group by a.channel_id,b.channel_id,sa.size,sb.size;
      insert into private.audience_overlap_history(workspace_id,channel_a,channel_b,day,a_size,b_size,shared)
      select workspace_id,channel_a,channel_b,(at_time at time zone 'UTC')::date,a_size,b_size,shared
        from private.audience_overlap_cells where workspace_id=w
      on conflict(workspace_id,channel_a,channel_b,day) do update set a_size=excluded.a_size,b_size=excluded.b_size,shared=excluded.shared;
      delete from private.audience_overlap_history where workspace_id=w and day < (at_time at time zone 'UTC')::date - 30;
      get diagnostics n = row_count;
      changed := changed + 1;
    exception when others then
      raise warning 'audience overlap refresh failed for workspace % (SQLSTATE %)', w, sqlstate;
    end;
  end loop;
  return changed;
end $$;
revoke all on function private.refresh_audience_overlap(interval) from public, anon, authenticated;
grant execute on function private.refresh_audience_overlap(interval) to service_role;

create function public.audience_overlap(p_channel uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ch public.channels; size_a int; u int; stamp timestamptz; result jsonb;
begin
  select * into ch from public.channels where id=p_channel;
  if ch.id is null or not private.has_role(ch.workspace_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if not private.switch_on('audience_overlap') then raise exception 'feature_unavailable' using errcode='P0001'; end if;
  if not private.overlap_allowed(ch.workspace_id) then raise exception 'plan_feature_unavailable' using errcode='P0001'; end if;
  select s.size,s.computed_at into size_a,stamp from private.audience_sizes s where s.workspace_id=ch.workspace_id and s.channel_id=ch.id;
  select au.size into u from private.audience_universe au where au.workspace_id=ch.workspace_id and au.platform=ch.platform;
  if size_a is null then return jsonb_build_object('status','pending','computed_at',null,'universe_size',null,'thresholds',jsonb_build_object('min_audience',100,'min_shared',10),'channel',jsonb_build_object('id',ch.id,'title',ch.title,'platform',ch.platform,'audience_size',null),'others','[]'::jsonb); end if;
  select coalesce(jsonb_agg(x.item order by x.shared_sort desc nulls last,x.channel_id), '[]'::jsonb) into result
    from (
      select other.id channel_id,
        jsonb_build_object('channel_id',other.id,'title',other.title,'handle',other.handle,'platform',other.platform,
          'audience_size',bsize,'below_threshold',below,
          'shared',case when below then null else sh end,
          'share_of_mine',case when below then null else round(sh::numeric/size_a,4) end,
          'share_of_mine_ci',case when below then null else jsonb_build_object('low',round(greatest(0,(p+z2/(2*size_a)-1.96*sqrt((p*(1-p)+z2/(4*size_a))/size_a))/(1+z2/size_a))::numeric,4),'high',round(least(1,(p+z2/(2*size_a)+1.96*sqrt((p*(1-p)+z2/(4*size_a))/size_a))/(1+z2/size_a))::numeric,4)) end,
          'share_of_theirs',case when below then null else round(sh::numeric/bsize,4) end,
          'overlap_coefficient',case when below then null else round(sh::numeric/least(size_a,bsize),4) end,
          'affinity',case when below or u is null or u=0 or bsize=0 then null else round(100*(sh::numeric/size_a)/(bsize::numeric/u)) end) item,
        case when below then null else sh end shared_sort
      from public.channels other
      left join private.audience_overlap_cells cell on cell.workspace_id=ch.workspace_id and
        ((cell.channel_a=ch.id and cell.channel_b=other.id) or (cell.channel_b=ch.id and cell.channel_a=other.id))
      left join private.audience_sizes os on os.workspace_id=ch.workspace_id and os.channel_id=other.id
      cross join lateral (select os.size bsize,coalesce(cell.shared,0) sh) vals
      cross join lateral (select (size_a<100 or vals.sh<10) below, case when size_a>0 then vals.sh::numeric/size_a else 0 end p, 1.96*1.96 z2) calc
      where other.workspace_id=ch.workspace_id and other.id<>ch.id and other.platform=ch.platform
    ) x;
  return jsonb_build_object('status','ready','computed_at',stamp,'universe_size',u,'thresholds',jsonb_build_object('min_audience',100,'min_shared',10),
    'channel',jsonb_build_object('id',ch.id,'title',ch.title,'platform',ch.platform,'audience_size',size_a),'others',result);
end $$;
revoke all on function public.audience_overlap(uuid) from public, anon;
grant execute on function public.audience_overlap(uuid) to authenticated;

create function public.audience_overlap_available(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object('switch_on',private.switch_on('audience_overlap'),'plan_allows',private.overlap_allowed(p_workspace));
end $$;
revoke all on function public.audience_overlap_available(uuid) from public, anon;
grant execute on function public.audience_overlap_available(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_available_extensions where name='pg_cron') then return; end if;
  execute 'create extension if not exists pg_cron';
  perform cron.unschedule(jobid) from cron.job where jobname='audience-overlap-refresh';
  perform cron.schedule('audience-overlap-refresh','*/30 * * * *',$job$set local statement_timeout = '10min'; select private.refresh_audience_overlap()$job$);
end $$;
