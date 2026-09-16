-- The live check reads a video only when its comment count moved.
--
-- Every due video cost one commentThreads.list unit per page, even when
-- nothing had been written since the last read. videos.list(part=statistics)
-- answers fifty videos' commentCount for one unit. The worker now sends those
-- counts first (worker_video_counts); every selected video whose count is
-- exactly what it was at its last exhausted read is deferred by one live
-- interval and reported as 'unchanged'; only the rest are read.
-- docs/pricing-consultation-2026-09-16.md §5.1 is the arithmetic: an agency
-- plan drops from ~800 units a day to ~16 plus the genuinely new comments.
--
-- Every create or replace below is a whole-body rewrite from the function's
-- latest definition (the file named at each), with only the named change.

-- The count at the last exhausted read. Null until a read has completed:
-- unknown is never "the same as now".
alter table public.video_selections
  add column last_seen_comment_count integer check (last_seen_comment_count >= 0);
-- When the source last answered a count for this video, by any path.
alter table public.videos add column reported_comment_count_at timestamptz;

-- due_videos, rebuilt from 20260915130000 with the two counts appended to
-- each item, so a worker can see what the server will compare.
create or replace function private.due_videos(w uuid, c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('video_id', v.id, 'external_video_id', v.external_video_id,
                              'title', v.title,
                              'last_seen_comment_count', s.last_seen_comment_count,
                              'reported_comment_count', v.reported_comment_count)
           order by s.next_check_at, v.id), '[]'::jsonb)
    from public.video_selections s
    join public.videos v on v.workspace_id = s.workspace_id and v.id = s.video_id
   where s.workspace_id = w and s.channel_id = c
     and s.next_check_at <= now()
     and v.comments_state <> 'disabled';
$$;

-- The counts the worker read for one unit, before it reads any video.
-- payload = [{"external_video_id": "...", "comment_count": 123 | null}]; a
-- null count is the source declining to report one (comments switched off).
-- Every item must be well-formed or nothing is written: a batch that is
-- built wrong is refused whole, never filtered. Ids of videos this
-- workspace+channel does not hold are ignored — they are not the worker's
-- error to hear about, and the tenant they belong to is not this one.
create function private.worker_video_counts(token_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
        -- A count is a whole, non-negative number. A fraction or a negative
        -- would otherwise fail the column check as a bare 23514.
        or (jsonb_typeof(i->'comment_count') = 'number'
            and (i->>'comment_count') !~ '^[0-9]+$')) then
    raise exception 'invalid_counts' using errcode='22023'; end if;

  -- The stored count follows the source; a null answer leaves the old value
  -- in place but still records that the source was asked. The last item wins
  -- when an id is repeated, as it would if the payload were applied in order.
  update public.videos v
     set reported_comment_count = coalesce(p.cnt, v.reported_comment_count),
         reported_comment_count_at = now()
    from (select distinct on (i->>'external_video_id')
                 i->>'external_video_id' as ext, (i->>'comment_count')::int as cnt
            from jsonb_array_elements(payload) with ordinality as x(i, ord)
           order by i->>'external_video_id', ord desc) p
   where v.workspace_id = w and v.channel_id = c and v.external_video_id = p.ext;
  get diagnostics updated = row_count;

  -- Deferred: selected, the source reported a count, and it is exactly the
  -- count the last exhausted read ended at. 'unchanged' is a deferral that
  -- followed such a read with no read since, so its last_seen still stands;
  -- comparing only after 'exhausted' would read every second check and
  -- halve the saving. A partial read never set last_seen, so it is never
  -- deferred; a null last_seen (never read) is never equal to anything.
  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
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
     and s.last_outcome in ('exhausted', 'unchanged');
  get diagnostics unchanged = row_count;

  return jsonb_build_object(
    'read', coalesce((select jsonb_agg(d->'external_video_id')
                        from jsonb_array_elements(private.due_videos(w, c)) d), '[]'::jsonb),
    'unchanged', unchanged, 'updated', updated);
end $$;

-- worker_video_finished, rebuilt from 20260915132000 with one addition: an
-- exhausted read records the count it was read at, so the next live check
-- has something to compare the source's answer against.
create or replace function private.worker_video_finished(
  token_hash text, j uuid, t uuid, v uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; iv int; begin
  w := private.worker_job(token_hash, j, t);
  if outcome not in ('exhausted','partial','blocked','failed') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  if not exists(select 1 from public.videos where workspace_id = w and id = v) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
  if outcome = 'exhausted' then
    update public.video_selections
       set last_collected_at = now(), last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => iv),
           last_seen_comment_count = (select reported_comment_count from public.videos
                                       where workspace_id = w and id = v)
     where workspace_id = w and video_id = v;
    update public.videos set comments_state = 'open' where workspace_id = w and id = v;
  elsif reason = 'comments_disabled' then
    update public.videos set comments_state = 'disabled' where workspace_id = w and id = v;
    update public.video_selections set last_outcome = 'comments_disabled'
     where workspace_id = w and video_id = v;
  else
    update public.video_selections set last_outcome = coalesce(reason, outcome)
     where workspace_id = w and video_id = v;
  end if;
end $$;

create function public.svc_worker_video_counts(credential_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_video_counts(credential_hash, j, t, payload) $$;

revoke all on function
  private.worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_video_counts(text,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function
  private.worker_video_counts(text,uuid,uuid,jsonb),
  public.svc_worker_video_counts(text,uuid,uuid,jsonb)
  to service_role;
