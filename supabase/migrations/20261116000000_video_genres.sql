-- Video genre classification is deliberately gated until the YouTube Derived
-- Metrics amendment is accepted. The data path exists, but the default switch
-- keeps both scheduling and model calls off.

create table private.platform_switches (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into private.platform_switches(key, enabled)
values ('genre_classification', false);

create function private.switch_on(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from private.platform_switches s where s.key = p_key), false)
$$;
revoke all on function private.switch_on(text) from public, anon, authenticated;
grant execute on function private.switch_on(text) to service_role;

create function public.admin_set_platform_switch(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed int;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update private.platform_switches
     set enabled = p_enabled, updated_at = now(), updated_by = uid
   where key = p_key;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'invalid_input' using errcode = '22023'; end if;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (null, uid, 'platform_switch_set', 'platform_switch', p_key);
end $$;
revoke all on function public.admin_set_platform_switch(text, boolean) from public, anon;
grant execute on function public.admin_set_platform_switch(text, boolean) to authenticated;

create table public.video_genre_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  video_id uuid not null,
  classification_key text not null,
  taxonomy_version int not null,
  status text not null check (status in ('succeeded','skipped','failed','unsupported')),
  genre_key text null,
  confidence numeric(4,3) null check (confidence is null or confidence between 0 and 1),
  model_id text not null,
  prompt_version text not null,
  error_code text null,
  predicted_at timestamptz not null default now(),
  check ((status = 'succeeded') = (genre_key is not null)),
  unique (workspace_id, video_id, classification_key),
  foreign key (workspace_id, video_id) references public.videos(workspace_id, id),
  foreign key (taxonomy_version, genre_key) references public.genre_taxonomy(version, key)
);
alter table public.video_genre_predictions enable row level security;
revoke all on table public.video_genre_predictions from public, anon, authenticated;
grant select on table public.video_genre_predictions to authenticated;
grant all on table public.video_genre_predictions to service_role;
create policy tenant_read on public.video_genre_predictions for select to authenticated
  using (private.has_role(workspace_id));

create function private.genre_classification_key(
  taxonomy_version int, model_id text, prompt_version text
) returns text language sql immutable set search_path = '' as $$
  select 'genres:v' || taxonomy_version || '+' || model_id || '+' || prompt_version
$$;
revoke all on function private.genre_classification_key(int,text,text) from public, anon, authenticated;
grant execute on function private.genre_classification_key(int,text,text) to service_role;

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('discover','collect','analyse','genre_classify','import','export'));

create unique index jobs_one_outstanding_genre_classify
  on public.jobs(workspace_id, channel_id)
  where type = 'genre_classify' and status in ('queued','running');

create function private.genres_pending(w uuid, c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with current_key as (
    select private.genre_classification_key(max(version), 'gemini-3.6-flash', 'g1') as key
      from public.genre_taxonomy_versions
  ), recent as (
    select v.id from public.videos v
     where v.workspace_id = w and v.channel_id = c and length(trim(v.title)) > 0
     order by v.published_at desc nulls last, v.id
     limit 50
  )
  select exists (
    select 1 from recent r, current_key k
     where not exists (
       select 1 from public.video_genre_predictions p
        where p.workspace_id = w and p.video_id = r.id
          and p.classification_key = k.key
          and p.status in ('succeeded','skipped','unsupported')
     )
  )
$$;
revoke all on function private.genres_pending(uuid,uuid) from public, anon, authenticated;
grant execute on function private.genres_pending(uuid,uuid) to service_role;

create or replace function private.schedule_due_work(w uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare ch record; d int := 0; k int := 0; a int := 0; g int := 0; cat int;
        genres_enabled boolean := private.switch_on('genre_classification'); begin
  perform private.unblock_due_jobs();
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status in ('connected', 'public_unverified')
               and paused_at is null loop
    if ch.catalogued_at is null or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    perform private.auto_select_videos(w, ch.id);
    if private.has_due_videos(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
    if genres_enabled and private.genres_pending(w, ch.id)
       and not exists (select 1 from public.jobs j where j.workspace_id = w
                        and j.channel_id = ch.id and j.type = 'genre_classify'
                        and j.created_at > now() - interval '24 hours') then
      if private.enqueue_scheduled(w, ch.id, 'genre_classify') is not null then g := g + 1; end if;
    end if;
  end loop;
  if genres_enabled then
    return jsonb_build_object('discover', d, 'collect', k, 'analyse', a, 'genre_classify', g);
  end if;
  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $$;

create function private.worker_genres_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int
) returns jsonb language plpgsql set search_path = '' as $$
declare w uuid; c uuid; kind text; v int; k text; cap int; taxonomy jsonb; rows jsonb;
begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'genre_classify' then raise exception 'invalid_job_type' using errcode = '22023'; end if;
  if not private.switch_on('genre_classification') then
    return jsonb_build_object('blocked', 'genre_classification_off');
  end if;
  if model_id !~ '^[A-Za-z0-9._-]{1,80}$' or prompt_version !~ '^[A-Za-z0-9._-]{1,20}$' then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  select max(version) into v from public.genre_taxonomy_versions;
  k := private.genre_classification_key(v, model_id, prompt_version);
  cap := least(greatest(coalesce(max_rows, 50), 1), 50);
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', x.key, 'parent_key', x.parent_key, 'level', x.level,
           'name_en', x.name_en, 'description', x.description)
           order by x.level, x.parent_position, x.position), '[]'::jsonb)
    into taxonomy
    from (
      select g.*, coalesce(parent.position, g.position) parent_position
        from public.genre_taxonomy g
        left join public.genre_taxonomy parent
          on parent.version = g.version and parent.key = g.parent_key
       where g.version = v
    ) x;
  with recent as (
    select vd.* from public.videos vd
     where vd.workspace_id = w and vd.channel_id = c and length(trim(vd.title)) > 0
     order by vd.published_at desc nulls last, vd.id limit 50
  ), due as (
    select r.* from recent r
     where not exists (
       select 1 from public.video_genre_predictions p
        where p.workspace_id = w and p.video_id = r.id and p.classification_key = k
          and p.status in ('succeeded','skipped','unsupported'))
     order by r.published_at desc nulls last, r.id limit cap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'external_video_id', d.external_video_id, 'title', d.title,
           'description', left(coalesce(d.description,''), 500),
           'tags', coalesce(to_jsonb(d.tags), '[]'::jsonb),
           'category_id', d.category_id, 'duration_sec', d.duration_sec)
           order by d.published_at desc nulls last, d.id), '[]'::jsonb)
    into rows from due d;
  return jsonb_build_object('classification_key', k, 'taxonomy_version', v,
                            'taxonomy', taxonomy, 'rows', rows);
end $$;

create function private.worker_commit_genres(
  token_hash text, j uuid, t uuid, b text, records jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare w uuid; c uuid; kind text; current_version int; hash text; prior text; n int;
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
    returning 1)
  select count(*)::int into n from written;
  insert into private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  values (j, b, '{}'::jsonb, hash, 'partial');
  return jsonb_build_object('replayed', false, 'stored', n);
end $$;

create function public.svc_worker_genres_due(
  credential_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int
) returns jsonb language sql set search_path = '' as $$
  select private.worker_genres_due(credential_hash, j, t, model_id, prompt_version, max_rows)
$$;
create function public.svc_worker_commit_genres(
  credential_hash text, j uuid, t uuid, b text, records jsonb
) returns jsonb language sql set search_path = '' as $$
  select private.worker_commit_genres(credential_hash, j, t, b, records)
$$;

revoke all on function private.worker_genres_due(text,uuid,uuid,text,text,int) from public, anon, authenticated;
revoke all on function private.worker_commit_genres(text,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.svc_worker_genres_due(text,uuid,uuid,text,text,int) from public, anon, authenticated;
revoke all on function public.svc_worker_commit_genres(text,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function private.worker_genres_due(text,uuid,uuid,text,text,int) to service_role;
grant execute on function private.worker_commit_genres(text,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.svc_worker_genres_due(text,uuid,uuid,text,text,int) to service_role;
grant execute on function public.svc_worker_commit_genres(text,uuid,uuid,text,jsonb) to service_role;
