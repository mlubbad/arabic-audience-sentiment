-- Worker RPC statement timeout hardening & comment last_seen_at touch throttle:
-- 1. In `private.worker_video_counts`, only update `public.comments.last_seen_at = now()`
--    on unchanged videos when `cm.last_seen_at < now() - interval '7 days'`. Since
--    `private.purge_comment_text` purges comments only after 30 days of inactivity,
--    refreshing once per 7 days guarantees active monitored videos never lose their text
--    while avoiding rewriting tens of thousands of comment rows on every hourly check
--    (which triggered PostgREST 8s `57014 statement_timeout` on large channels).
-- 2. Set explicit `statement_timeout = '30s'` on `svc_worker_video_counts`,
--    `svc_worker_commit_batch`, `svc_worker_commit_catalogue`, `svc_worker_due_videos`,
--    `svc_worker_known_videos`, `svc_worker_claim`, `svc_worker_commit_topics`,
--    `svc_worker_commit_genres`, and `svc_worker_genres_due` (matching `svc_worker_tick`
--    and `svc_worker_topics_due`).

CREATE OR REPLACE FUNCTION private.worker_video_counts(token_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
declare w uuid; c uuid; iv int; updated int; unchanged int; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'invalid_counts' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload) i
     where jsonb_typeof(i) <> 'object'
        or coalesce(i->>'external_video_id','') !~ '^[A-Za-z0-9_-]{11}$'
        or not (i ? 'comment_count')
        or jsonb_typeof(i->'comment_count') not in ('number','null')
        or (jsonb_typeof(i->'comment_count') = 'number'
            and (i->>'comment_count') !~ '^[0-9]+$')) then
    raise exception 'invalid_counts' using errcode='22023'; end if;

  update public.videos v
     set reported_comment_count = coalesce(p.cnt, v.reported_comment_count),
         reported_comment_count_at = now()
    from (select distinct on (i->>'external_video_id')
                 i->>'external_video_id' as ext, (i->>'comment_count')::int as cnt
            from jsonb_array_elements(payload) with ordinality as x(i, ord)
           order by i->>'external_video_id', ord desc) p
   where v.workspace_id = w and v.channel_id = c and v.external_video_id = p.ext;
  get diagnostics updated = row_count;

  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
  with deferred as (
    update public.video_selections s
       set next_check_at = now() + make_interval(mins => iv),
           last_outcome = 'unchanged'
      from public.videos v
      join (select distinct on (i->>'external_video_id')
                   i->>'external_video_id' as ext, (i->>'comment_count')::int as cnt
              from jsonb_array_elements(payload) with ordinality as x(i, ord)
             order by i->>'external_video_id', ord desc) p on p.ext = v.external_video_id
     where s.workspace_id = w and s.channel_id = c and s.video_id = v.id
       and v.workspace_id = w and v.channel_id = c
       and p.cnt is not null and s.last_seen_comment_count = p.cnt
       and s.last_outcome in ('exhausted', 'unchanged')
     returning s.video_id
  ), touched_comments as (
    update public.comments cm
       set last_seen_at = now()
      from deferred d
     where cm.workspace_id = w
       and cm.video_id = d.video_id
       and cm.content_purged_at is null
       and cm.last_seen_at < now() - interval '7 days'
  )
  select count(*)::int into unchanged from deferred;

  return jsonb_build_object(
    'read', coalesce((select jsonb_agg(d->'external_video_id')
                        from jsonb_array_elements(private.due_videos(w, c)) d), '[]'::jsonb),
    'unchanged', unchanged, 'updated', updated);
end $function$;

CREATE OR REPLACE FUNCTION public.svc_worker_video_counts(credential_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_video_counts(credential_hash, j, t, payload)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_commit_batch(credential_hash text, j uuid, t uuid, b text, hash text, payload jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_commit_batch(credential_hash, j, t, b, hash, payload)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_commit_catalogue(credential_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_commit_catalogue(credential_hash, j, t, payload)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_due_videos(credential_hash text, j uuid, t uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_due_videos(credential_hash, j, t)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_known_videos(credential_hash text, j uuid, t uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_known_videos(credential_hash, j, t)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_claim(credential_hash text)
RETURNS SETOF public.jobs
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '25s'
AS $function$
  select * from private.worker_claim(credential_hash)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_claim(credential_hash text, job_types text[])
RETURNS SETOF public.jobs
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '25s'
AS $function$
  select * from private.claim_job(private.worker_workspace(credential_hash), job_types)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_commit_topics(credential_hash text, j uuid, t uuid, b text, records jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_commit_topics(credential_hash, j, t, b, records)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_commit_genres(credential_hash text, j uuid, t uuid, b text, records jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  select private.worker_commit_genres(credential_hash, j, t, b, records)
$function$;

CREATE OR REPLACE FUNCTION public.svc_worker_genres_due(credential_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows integer)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
SET statement_timeout TO '25s'
AS $function$
  select private.worker_genres_due(credential_hash, j, t, model_id, prompt_version, max_rows)
$function$;

REVOKE ALL ON FUNCTION
  private.worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_commit_batch(text,uuid,uuid,text,text,jsonb),
  public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_due_videos(text,uuid,uuid),
  public.svc_worker_known_videos(text,uuid,uuid),
  public.svc_worker_claim(text),
  public.svc_worker_claim(text,text[]),
  public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_commit_genres(text,uuid,uuid,text,jsonb),
  public.svc_worker_genres_due(text,uuid,uuid,text,text,integer)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  private.worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_commit_batch(text,uuid,uuid,text,text,jsonb),
  public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_due_videos(text,uuid,uuid),
  public.svc_worker_known_videos(text,uuid,uuid),
  public.svc_worker_claim(text),
  public.svc_worker_claim(text,text[]),
  public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_commit_genres(text,uuid,uuid,text,jsonb),
  public.svc_worker_genres_due(text,uuid,uuid,text,text,integer)
  TO service_role;
