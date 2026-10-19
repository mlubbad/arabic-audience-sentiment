create table public.channel_genres (
  workspace_id uuid not null,
  channel_id uuid not null,
  classification_key text not null,
  taxonomy_version int not null,
  genre_key text not null,
  level smallint not null check (level between 1 and 3),
  weight numeric(5,4) not null check (weight between 0 and 1),
  videos int not null check (videos > 0),
  computed_at timestamptz not null,
  primary key (workspace_id, channel_id, classification_key, genre_key),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id,id) on delete cascade,
  foreign key (taxonomy_version, genre_key) references public.genre_taxonomy(version,key)
);
alter table public.channel_genres enable row level security;
revoke all on public.channel_genres from public, anon, authenticated;
grant select on public.channel_genres to authenticated;
grant all on public.channel_genres to service_role;
create policy tenant_read on public.channel_genres for select to authenticated using (private.has_role(workspace_id));

create table public.channel_genre_reviews (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, channel_id uuid not null,
  taxonomy_version int not null, main_key text not null, primary_key text,
  secondary_keys text[] not null default '{}', reason text, reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id,channel_id) references public.channels(workspace_id,id) on delete cascade,
  foreign key (taxonomy_version,main_key) references public.genre_taxonomy(version,key),
  foreign key (taxonomy_version,primary_key) references public.genre_taxonomy(version,key)
);
create index channel_genre_reviews_latest on public.channel_genre_reviews(workspace_id,channel_id,created_at desc,id desc);
alter table public.channel_genre_reviews enable row level security;
revoke all on public.channel_genre_reviews from public,anon,authenticated;
grant select on public.channel_genre_reviews to authenticated;
grant all on public.channel_genre_reviews to service_role;
create policy tenant_read on public.channel_genre_reviews for select to authenticated using (private.has_role(workspace_id));

create function private.refresh_channel_genres(w uuid,c uuid,p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare v int;
begin
 select max(taxonomy_version) into v from public.video_genre_predictions p
  join public.videos vd on vd.workspace_id=p.workspace_id and vd.id=p.video_id
 where p.workspace_id=w and vd.channel_id=c and p.classification_key=p_key and p.status='succeeded';
 delete from public.channel_genres where workspace_id=w and channel_id=c and classification_key=p_key;
 if v is null then return; end if;
 with recent as (
  select p.genre_key,p.video_id,vd.published_at,vd.view_count,
         ln(1+coalesce(vd.view_count,0)::numeric)+1 as popularity,
         case when vd.published_at is null then 0.5 else power(0.5::numeric,
           greatest(0,extract(epoch from (now()-vd.published_at))/86400)/90) end as recency
   from public.video_genre_predictions p join public.videos vd
    on vd.workspace_id=p.workspace_id and vd.id=p.video_id
  where p.workspace_id=w and vd.channel_id=c and p.classification_key=p_key
    and p.taxonomy_version=v and p.status='succeeded'
  order by vd.published_at desc nulls last,vd.id limit 50
 ), enough as (select count(distinct video_id) n from recent), rolled as (
  select g.version,g.key,g.level,r.video_id,r.popularity*r.recency raw_weight
   from recent r join public.genre_taxonomy leaf on leaf.version=v and leaf.key=r.genre_key
   join public.genre_taxonomy g on g.version=leaf.version and
    (g.key=leaf.key or g.key=leaf.parent_key or g.key=(select p.parent_key from public.genre_taxonomy p where p.version=leaf.version and p.key=leaf.parent_key))
 ), agg as (
  select version,key,level,count(distinct video_id)::int videos,sum(raw_weight) raw_weight
    from rolled group by version,key,level
 ), normalized as (
  select a.*,sum(raw_weight) over(partition by level) total from agg a
 )
 insert into public.channel_genres(workspace_id,channel_id,classification_key,taxonomy_version,genre_key,level,weight,videos,computed_at)
 select w,c,p_key,n.version,n.key,n.level,
        case when row_number() over(partition by n.level order by n.raw_weight desc,n.key)=1
          then (1 - coalesce(sum(round((n.raw_weight/n.total)::numeric,4)) over(partition by n.level
                    order by n.raw_weight desc,n.key rows between 1 following and unbounded following),0))::numeric(5,4)
          else round((raw_weight/total)::numeric,4) end,
        videos,now()
 from normalized n, enough where enough.n>=5;
end $$;
revoke all on function private.refresh_channel_genres(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.refresh_channel_genres(uuid,uuid,text) to service_role;

create or replace function private.worker_commit_genres(
  token_hash text, j uuid, t uuid, b text, records jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare w uuid; c uuid; kind text; current_version int; hash text; prior text; n int; k text;
begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'genre_classify' then raise exception 'invalid_job_type' using errcode = '22023'; end if;
  if b is null or length(b) not between 1 and 200 or records is null
     or jsonb_typeof(records) <> 'array' then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(records) > 50 then raise exception 'batch_too_large' using errcode = '22023'; end if;
  select max(version) into current_version from public.genre_taxonomy_versions;
  if exists (
    select 1 from jsonb_array_elements(records) r
     where jsonb_typeof(r) <> 'object'
        or jsonb_typeof(r->'external_video_id') <> 'string'
        or coalesce(r->>'external_video_id','') = ''
        or r->>'status' not in ('succeeded','skipped','failed','unsupported')
        or ((r->>'status' = 'succeeded') <> (r->>'genre_key' is not null))
        or case
             when not r ? 'confidence' or jsonb_typeof(r->'confidence') = 'null' then false
             when jsonb_typeof(r->'confidence') <> 'number' then true
             else (r->>'confidence')::numeric not between 0 and 1
           end
        or jsonb_typeof(r->'model_id') <> 'string'
        or coalesce(r->>'model_id','') !~ '^[A-Za-z0-9._-]{1,80}$'
        or jsonb_typeof(r->'prompt_version') <> 'string'
        or coalesce(r->>'prompt_version','') !~ '^[A-Za-z0-9._-]{1,20}$'
        or case
             when jsonb_typeof(r->'taxonomy_version') <> 'number'
                  or coalesce(r->>'taxonomy_version','') !~ '^[1-9][0-9]*$' then true
             when (r->>'taxonomy_version')::numeric > 2147483647 then true
             else (r->>'taxonomy_version')::int <> current_version
               or r->>'classification_key' is distinct from private.genre_classification_key(
                    (r->>'taxonomy_version')::int, r->>'model_id', r->>'prompt_version')
               or (r->>'genre_key' is not null and not exists (
                    select 1 from public.genre_taxonomy g
                     where g.version = (r->>'taxonomy_version')::int
                       and g.key = r->>'genre_key'))
           end
        or not exists (
             select 1 from public.videos vd where vd.workspace_id = w and vd.channel_id = c
               and vd.external_video_id = r->>'external_video_id')
  ) or (select count(distinct r->>'external_video_id') from jsonb_array_elements(records) r)
       <> jsonb_array_length(records) then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  hash := encode(sha256(convert_to(records::text, 'UTF8')), 'hex');
  select payload_hash into prior from private.job_batches where job_id = j and batch_key = b;
  if found then
    if prior is distinct from hash then raise exception 'batch_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('replayed', true, 'stored', 0);
  end if;
  with written as (
    insert into public.video_genre_predictions(
      workspace_id, video_id, classification_key, taxonomy_version, status, genre_key,
      confidence, model_id, prompt_version, error_code)
    select w, vd.id, r.classification_key, r.taxonomy_version, r.status, r.genre_key,
           r.confidence, r.model_id, r.prompt_version, r.error_code
      from jsonb_to_recordset(records) as r(
        external_video_id text, classification_key text, taxonomy_version int,
        status text, genre_key text, confidence numeric, model_id text,
        prompt_version text, error_code text)
      join public.videos vd on vd.workspace_id = w and vd.channel_id = c
       and vd.external_video_id = r.external_video_id
    on conflict (workspace_id, video_id, classification_key) do update set
      taxonomy_version = excluded.taxonomy_version, status = excluded.status,
      genre_key = excluded.genre_key, confidence = excluded.confidence,
      model_id = excluded.model_id, prompt_version = excluded.prompt_version,
      error_code = excluded.error_code, predicted_at = now()
    where public.video_genre_predictions.status = 'failed'
    returning classification_key)
  select count(*)::int, min(classification_key) into n, k from written;
  insert into private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  values (j, b, '{}'::jsonb, hash, 'partial');
  if k is not null then perform private.refresh_channel_genres(w, c, k); end if;
  return jsonb_build_object('replayed', false, 'stored', n);
end $$;

create function public.channel_genre_review_set(p_channel uuid,p_main text,p_primary text,p_secondary text[],p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; me uuid:=auth.uid(); v_taxonomy int; rid uuid;
begin
 select workspace_id into w from public.channels where id=p_channel;
 if me is null or not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 select max(gtv.version) into v_taxonomy from public.genre_taxonomy_versions gtv;
 if p_secondary is null or cardinality(p_secondary)>5 or cardinality(p_secondary)<>(select count(distinct x) from unnest(p_secondary) x)
  or not exists(select 1 from public.genre_taxonomy g where g.version=v_taxonomy and g.key=p_main and g.level=1)
  or (p_primary is not null and not exists(select 1 from public.genre_taxonomy g where g.version=v_taxonomy and g.key=p_primary and g.parent_key=p_main and g.level=2))
  or exists(select 1 from unnest(p_secondary) x left join public.genre_taxonomy g on g.version=v_taxonomy and g.key=x where g.key is null or g.level not in (2,3)) then raise exception 'invalid_input' using errcode='22023'; end if;
 insert into public.channel_genre_reviews(workspace_id,channel_id,taxonomy_version,main_key,primary_key,secondary_keys,reason,reviewer_id) values(w,p_channel,v_taxonomy,p_main,p_primary,p_secondary,p_reason,me) returning id into rid;
 insert into public.audit_events(workspace_id,actor_id,action,target_type,target_id) values(w,me,'channel_genre_review_set','channel',p_channel::text);
 return rid;
end $$;
create function public.channel_genre_review_clear(p_channel uuid) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; me uuid:=auth.uid(); begin
 select workspace_id into w from public.channels where id=p_channel;
 if me is null or not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 delete from public.channel_genre_reviews where workspace_id=w and channel_id=p_channel;
 insert into public.audit_events(workspace_id,actor_id,action,target_type,target_id) values(w,me,'channel_genre_review_clear','channel',p_channel::text);
end $$;

create function public.channel_genre_profile(p_channel uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; outval jsonb;
begin
 select workspace_id into w from public.channels where id=p_channel;
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 if not private.switch_on('genre_classification') then return jsonb_build_object('blocked','genre_classification_off'); end if;
 with model_rows as (select cg.*,g.name_ar,g.name_en,g.parent_key,g.position from public.channel_genres cg join public.genre_taxonomy g on g.version=cg.taxonomy_version and g.key=cg.genre_key where cg.workspace_id=w and cg.channel_id=p_channel), latest as (select * from public.channel_genre_reviews where workspace_id=w and channel_id=p_channel order by created_at desc,id desc limit 1), totals as (select taxonomy_version,classification_key,max(computed_at) computed_at,max(videos) videos from model_rows group by 1,2 order by computed_at desc limit 1), main as (select * from model_rows where level=1 order by weight desc,position limit 1), primary_genre as (select c.* from model_rows c join main m on c.parent_key=m.genre_key where c.level=2 order by c.weight desc,c.position limit 1)
 select jsonb_build_object('taxonomy_version',t.taxonomy_version,'classification_key',t.classification_key,'source',case when rv.id is not null then 'reviewed' when t.taxonomy_version is not null then 'model' else null end,'main',coalesce(rv.main_key,m.genre_key),'primary',coalesce(rv.primary_key,pg.genre_key),'secondary',coalesce(to_jsonb(rv.secondary_keys), (select coalesce(jsonb_agg(x.genre_key order by x.position),'[]'::jsonb) from model_rows x where x.level in (2,3) and x.genre_key<>coalesce(pg.genre_key,'') and x.weight>=.15 and (m.genre_key is null or x.genre_key<>m.genre_key))),'weights',coalesce((select jsonb_agg(jsonb_build_object('genre_key',genre_key,'level',level,'weight',weight,'name_ar',name_ar,'name_en',name_en) order by level,position) from model_rows),'[]'::jsonb),'videos',t.videos,'computed_at',t.computed_at) into outval from totals t full join (select 1) z on true left join main m on true left join primary_genre pg on true left join latest rv on true;
 return coalesce(outval,jsonb_build_object('taxonomy_version',null,'classification_key',null,'source',null,'main',null,'primary',null,'secondary','[]'::jsonb,'weights','[]'::jsonb,'videos',null,'computed_at',null));
end $$;
revoke all on function public.channel_genre_review_set(uuid,text,text,text[],text),public.channel_genre_review_clear(uuid),public.channel_genre_profile(uuid) from public,anon;
grant execute on function public.channel_genre_review_set(uuid,text,text,text[],text),public.channel_genre_review_clear(uuid),public.channel_genre_profile(uuid) to authenticated;
