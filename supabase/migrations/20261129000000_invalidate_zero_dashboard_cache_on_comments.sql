-- Invalidate pre-collection zero-comment / zero-analysis dashboard cache entries
-- as soon as comments or sentiment predictions arrive.

CREATE OR REPLACE FUNCTION private.invalidate_zero_dashboard_cache_on_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  UPDATE private.dashboard_aggregates_cache c
     SET payload = NULL,
         computed_at = NULL,
         requested_at = now()
    FROM (SELECT DISTINCT workspace_id FROM inserted) ins
   WHERE c.workspace_id = ins.workspace_id
     AND c.payload IS NOT NULL
     AND coalesce((c.payload->>'workspace_total')::int, 0) = 0;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION private.invalidate_zero_dashboard_cache_on_comment_insert() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS comments_invalidate_zero_dashboard_cache ON public.comments;
CREATE TRIGGER comments_invalidate_zero_dashboard_cache
  AFTER INSERT ON public.comments
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.invalidate_zero_dashboard_cache_on_comment_insert();

CREATE OR REPLACE FUNCTION private.invalidate_dashboard_cache_on_channel_analysis_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.active_analysis_key IS DISTINCT FROM OLD.active_analysis_key THEN
    UPDATE private.dashboard_aggregates_cache
       SET payload = NULL,
           computed_at = NULL,
           requested_at = now()
     WHERE workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION private.invalidate_dashboard_cache_on_channel_analysis_key() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS channels_invalidate_dashboard_cache_on_key ON public.channels;
CREATE TRIGGER channels_invalidate_dashboard_cache_on_key
  AFTER UPDATE OF active_analysis_key ON public.channels
  FOR EACH ROW
  EXECUTE FUNCTION private.invalidate_dashboard_cache_on_channel_analysis_key();

CREATE OR REPLACE FUNCTION private.dashboard_aggregates_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
declare
  filters jsonb := jsonb_strip_nulls(coalesce(f, '{}'::jsonb));
  k       text;
  c       private.dashboard_aggregates_cache;
  stale   boolean;
  fresh_payload jsonb;
begin
  if not (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
          or current_user = 'service_role'
          or private.has_role(w)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Free-text search is open-ended (a row per typed string would never be read
  -- twice) and is served by the trigram index, so it is still answered live.
  if nullif(trim(filters->>'q'), '') is not null then
    return private.dashboard_aggregates_compute(w, filters);
  end if;

  k := md5(filters::text);

  select * into c from private.dashboard_aggregates_cache
   where workspace_id = w and filter_key = k;

  if not found then
    insert into private.dashboard_aggregates_cache(workspace_id, filter_key, filters)
    values (w, k, filters)
    on conflict do nothing;
    return jsonb_build_object('cache', jsonb_build_object('state', 'pending'));
  end if;

  -- If the cached payload was computed when the workspace had 0 comments or 0 analysed
  -- predictions, and data has since arrived, never serve the stale zero state.
  if c.payload is not null
     and (
       (coalesce((c.payload->>'workspace_total')::int, 0) = 0
        and exists (select 1 from public.comments cm where cm.workspace_id = w limit 1))
       or
       (coalesce((c.payload->>'analysed')::int, 0) = 0
        and exists (select 1 from public.sentiment_predictions sp where sp.workspace_id = w and sp.status = 'succeeded' limit 1))
     ) then
    if exists (select 1 from public.sentiment_predictions sp where sp.workspace_id = w and sp.status = 'succeeded' limit 1)
       and not exists (select 1 from (select 1 from public.comments cm where cm.workspace_id = w limit 5001) x offset 5000) then
      fresh_payload := private.dashboard_aggregates_compute(w, filters);
      update private.dashboard_aggregates_cache
         set payload = fresh_payload,
             computed_at = now(),
             requested_at = now(),
             last_error = null
       where workspace_id = w and filter_key = k;
      return fresh_payload || jsonb_build_object('cache', jsonb_build_object('state', 'fresh', 'computed_at', now()));
    end if;

    update private.dashboard_aggregates_cache
       set payload = null,
           computed_at = null,
           requested_at = now()
     where workspace_id = w and filter_key = k;
    return jsonb_build_object('cache', jsonb_build_object('state', 'pending'));
  end if;

  if c.payload is null then
    if exists (select 1 from public.sentiment_predictions sp where sp.workspace_id = w and sp.status = 'succeeded' limit 1)
       and not exists (select 1 from (select 1 from public.comments cm where cm.workspace_id = w limit 5001) x offset 5000) then
      fresh_payload := private.dashboard_aggregates_compute(w, filters);
      update private.dashboard_aggregates_cache
         set payload = fresh_payload,
             computed_at = now(),
             requested_at = now(),
             last_error = null
       where workspace_id = w and filter_key = k;
      return fresh_payload || jsonb_build_object('cache', jsonb_build_object('state', 'fresh', 'computed_at', now()));
    end if;

    update private.dashboard_aggregates_cache
       set requested_at = now()
     where workspace_id = w and filter_key = k;
    if c.last_error is not null then
      return jsonb_build_object('cache',
        jsonb_build_object('state', 'failed', 'error', c.last_error));
    end if;
    return jsonb_build_object('cache', jsonb_build_object('state', 'pending'));
  end if;

  stale := c.computed_at < now() - private.dashboard_aggregates_fresh_for();
  if stale or c.requested_at < now() - interval '1 hour' then
    -- Queue a refresh (and keep the row alive); once per staleness, not per read.
    if c.requested_at <= c.computed_at or c.requested_at < now() - interval '1 hour' then
      update private.dashboard_aggregates_cache
         set requested_at = now()
       where workspace_id = w and filter_key = k;
    end if;
  end if;

  return c.payload || jsonb_build_object('cache', jsonb_build_object(
    'state', case when stale then 'stale' else 'fresh' end,
    'computed_at', c.computed_at));
end
$fn$;

REVOKE ALL ON FUNCTION private.dashboard_aggregates_impl(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.dashboard_aggregates_impl(uuid, jsonb)
  TO authenticated, service_role;
