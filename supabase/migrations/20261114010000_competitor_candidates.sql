CREATE OR REPLACE FUNCTION private.valid_youtube_channel_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT value ~ '^UC[A-Za-z0-9_-]{22}$' $$;

REVOKE ALL ON FUNCTION private.valid_youtube_channel_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.valid_youtube_channel_id(text) TO service_role;

-- Keep public-channel registration and competitor ingestion on one validator.
CREATE OR REPLACE FUNCTION private.register_public_channel_impl(
  w uuid, c uuid, external text, handle text, title text, p_platform text DEFAULT 'youtube'
)
RETURNS public.channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE ch public.channels;
BEGIN
  IF NOT private.has_role(w, ARRAY['workspace_owner','analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions s JOIN public.plans p ON p.key = s.plan_key
     WHERE s.workspace_id = private.billing_root(w) AND private.subscription_open(s)
       AND (p.allow_public_channels OR p.internal)
  ) THEN
    RAISE EXCEPTION 'public_channels_not_allowed_on_plan' USING errcode = '53400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE workspace_id = w AND id = c) THEN
    RAISE EXCEPTION 'invalid_client' USING errcode = '23503';
  END IF;
  IF p_platform NOT IN ('youtube','telegram','x','tiktok','facebook','instagram') THEN
    RAISE EXCEPTION 'invalid_platform' USING errcode = '22023';
  END IF;
  IF p_platform = 'youtube' THEN
    IF NOT private.valid_youtube_channel_id(external) THEN
      RAISE EXCEPTION 'invalid_channel_id' USING errcode = '22023';
    END IF;
  ELSIF p_platform = 'telegram' THEN
    IF external !~ '^(@?[A-Za-z0-9_]{4,64}|-?[0-9]+)$' THEN
      RAISE EXCEPTION 'invalid_channel_id' USING errcode = '22023';
    END IF;
  ELSIF length(trim(external)) < 1 OR length(external) > 100 THEN
    RAISE EXCEPTION 'invalid_channel_id' USING errcode = '22023';
  END IF;
  handle := nullif(trim(coalesce(handle, '')), '');
  title := nullif(trim(coalesce(title, '')), '');
  IF handle IS NOT NULL AND length(handle) > 50 THEN
    RAISE EXCEPTION 'invalid_channel_handle' USING errcode = '22023';
  END IF;
  IF title IS NOT NULL AND length(title) > 200 THEN
    RAISE EXCEPTION 'invalid_channel_title' USING errcode = '22023';
  END IF;
  INSERT INTO public.channels(workspace_id, client_id, external_channel_id, handle, title, platform)
  VALUES (w, c, external, handle, title, p_platform)
  ON CONFLICT (workspace_id, platform, external_channel_id) DO NOTHING
  RETURNING * INTO ch;
  IF ch.id IS NULL THEN
    SELECT * INTO ch FROM public.channels
     WHERE workspace_id = w AND platform = p_platform
       AND external_channel_id = external AND client_id = c;
    IF ch.id IS NULL THEN
      RAISE EXCEPTION 'channel_claimed_by_other_client' USING errcode = '23505';
    END IF;
  END IF;
  PERFORM private.adopt_channel_content(w, ch.id);
  RETURN ch;
END
$$;

ALTER TABLE public.channels
  ADD COLUMN featured_checked_at timestamptz;

CREATE TABLE public.competitor_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'youtube' CHECK (platform = 'youtube'),
  candidate_external_id text NOT NULL CHECK (private.valid_youtube_channel_id(candidate_external_id)),
  title text,
  handle text,
  source text NOT NULL CHECK (source IN ('manual', 'featured')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_candidates_channel_fkey
    FOREIGN KEY (workspace_id, channel_id)
    REFERENCES public.channels(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT competitor_candidates_identity_key
    UNIQUE (workspace_id, channel_id, platform, candidate_external_id, source),
  CONSTRAINT competitor_candidates_metadata_length
    CHECK ((title IS NULL OR length(title) <= 200) AND (handle IS NULL OR length(handle) <= 200)),
  CONSTRAINT competitor_candidates_added_by_source
    CHECK (source = 'manual' OR added_by IS NULL),
  CONSTRAINT competitor_candidates_seen_order
    CHECK (last_seen_at >= first_seen_at)
);

ALTER TABLE public.competitor_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY competitor_candidates_member_read ON public.competitor_candidates
  FOR SELECT TO authenticated USING (private.has_role(workspace_id));

REVOKE ALL ON TABLE public.competitor_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.competitor_candidates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.competitor_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.competitor_candidate_add(
  p_channel uuid, p_external text, p_title text, p_handle text
)
RETURNS public.competitor_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ch public.channels;
  result public.competitor_candidates;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id, ARRAY['workspace_owner','analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT private.valid_youtube_channel_id(p_external)
     OR p_title IS NOT NULL AND length(p_title) > 200
     OR p_handle IS NOT NULL AND length(p_handle) > 200 THEN
    RAISE EXCEPTION 'invalid_input' USING errcode = '22023';
  END IF;
  IF ch.platform <> 'youtube' OR p_external = ch.external_channel_id THEN
    RAISE EXCEPTION 'invalid_candidate' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.competitor_candidates c
       WHERE c.workspace_id = ch.workspace_id AND c.channel_id = ch.id
         AND c.platform = 'youtube' AND c.candidate_external_id = p_external
         AND c.source = 'manual'
     ) AND (SELECT count(*) FROM public.competitor_candidates c
             WHERE c.workspace_id = ch.workspace_id AND c.channel_id = ch.id
               AND c.platform = 'youtube' AND c.source = 'manual') >= 100 THEN
    RAISE EXCEPTION 'candidate_limit_reached' USING errcode = '53400';
  END IF;

  INSERT INTO public.competitor_candidates(
    workspace_id, channel_id, candidate_external_id, title, handle, source, added_by
  ) VALUES (
    ch.workspace_id, ch.id, p_external, nullif(trim(p_title), ''),
    nullif(trim(p_handle), ''), 'manual', auth.uid()
  )
  ON CONFLICT (workspace_id, channel_id, platform, candidate_external_id, source)
  DO UPDATE SET title = excluded.title, handle = excluded.handle, last_seen_at = now()
  RETURNING * INTO result;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.competitor_candidate_remove(p_channel uuid, p_external text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE ch public.channels; removed_count int;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id, ARRAY['workspace_owner','analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  DELETE FROM public.competitor_candidates c
   WHERE c.workspace_id = ch.workspace_id AND c.channel_id = ch.id
     AND c.platform = 'youtube' AND c.candidate_external_id = p_external
     AND c.source = 'manual';
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RETURN removed_count > 0;
END
$$;

CREATE OR REPLACE FUNCTION public.competitor_candidates(p_channel uuid)
RETURNS TABLE (
  candidate_external_id text, title text, handle text, sources text[],
  first_seen_at timestamptz, last_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE ch public.channels;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT c.candidate_external_id,
         (array_agg(c.title ORDER BY (c.title IS NULL), c.last_seen_at DESC))[1],
         (array_agg(c.handle ORDER BY (c.handle IS NULL), c.last_seen_at DESC))[1],
         array_agg(c.source ORDER BY c.source), min(c.first_seen_at), max(c.last_seen_at)
    FROM public.competitor_candidates c
   WHERE c.workspace_id = ch.workspace_id AND c.channel_id = ch.id AND c.platform = 'youtube'
   GROUP BY c.candidate_external_id
   ORDER BY max(c.last_seen_at) DESC, c.candidate_external_id;
END
$$;

CREATE OR REPLACE FUNCTION private.worker_featured_due(token_hash text, j uuid, t uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE w uuid; c uuid; kind text; due boolean;
BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id, type INTO c, kind FROM public.jobs WHERE id = j;
  IF kind <> 'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode = '22023'; END IF;
  SELECT coalesce(ch.platform = 'youtube'
                  AND (ch.featured_checked_at IS NULL OR ch.featured_checked_at < now() - interval '7 days'), false)
    INTO due FROM public.channels ch WHERE ch.workspace_id = w AND ch.id = c;
  RETURN jsonb_build_object('due', coalesce(due, false));
END
$$;

CREATE OR REPLACE FUNCTION private.worker_commit_featured(
  token_hash text, j uuid, t uuid, b text, candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  w uuid; c uuid; kind text; external text; hash text; prior text; n int;
BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id, type INTO c, kind FROM public.jobs WHERE id = j;
  IF kind <> 'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode = '22023'; END IF;
  SELECT external_channel_id INTO external FROM public.channels
   WHERE workspace_id = w AND id = c AND platform = 'youtube';
  IF external IS NULL OR b IS NULL OR length(b) NOT BETWEEN 1 AND 200
     OR candidates IS NULL OR jsonb_typeof(candidates) <> 'array'
     OR jsonb_array_length(candidates) > 100 THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(candidates) item
     WHERE jsonb_typeof(item) <> 'object'
        OR item - ARRAY['candidate_external_id','title','handle'] <> '{}'::jsonb
        OR NOT private.valid_youtube_channel_id(item->>'candidate_external_id')
        OR item->>'candidate_external_id' = external
        OR (item ? 'title' AND jsonb_typeof(item->'title') NOT IN ('string','null'))
        OR (item ? 'handle' AND jsonb_typeof(item->'handle') NOT IN ('string','null'))
        OR length(item->>'title') > 200 OR length(item->>'handle') > 200
  ) OR (SELECT count(DISTINCT item->>'candidate_external_id')
          FROM jsonb_array_elements(candidates) item) <> jsonb_array_length(candidates) THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode = '22023';
  END IF;

  hash := encode(sha256(convert_to(candidates::text, 'UTF8')), 'hex');
  SELECT payload_hash INTO prior FROM private.job_batches WHERE job_id = j AND batch_key = b;
  IF found THEN
    IF prior IS DISTINCT FROM hash THEN RAISE EXCEPTION 'batch_conflict' USING errcode = '23505'; END IF;
    RETURN jsonb_build_object('replayed', true, 'stored', 0);
  END IF;

  DELETE FROM public.competitor_candidates old
   WHERE old.workspace_id = w AND old.channel_id = c AND old.platform = 'youtube'
     AND old.source = 'featured'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(candidates) item
                      WHERE item->>'candidate_external_id' = old.candidate_external_id);

  INSERT INTO public.competitor_candidates(
    workspace_id, channel_id, candidate_external_id, title, handle, source, added_by
  )
  SELECT w, c, x.candidate_external_id, nullif(trim(x.title), ''),
         nullif(trim(x.handle), ''), 'featured', NULL
    FROM jsonb_to_recordset(candidates) AS x(candidate_external_id text, title text, handle text)
  ON CONFLICT (workspace_id, channel_id, platform, candidate_external_id, source)
  DO UPDATE SET title = excluded.title, handle = excluded.handle, last_seen_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.channels SET featured_checked_at = now() WHERE workspace_id = w AND id = c;
  INSERT INTO private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  VALUES (j, b, '{}'::jsonb, hash, 'partial');
  RETURN jsonb_build_object('replayed', false, 'stored', n);
END
$$;

CREATE OR REPLACE FUNCTION public.svc_worker_featured_due(credential_hash text, j uuid, t uuid)
RETURNS jsonb LANGUAGE sql SET search_path = ''
AS $$ SELECT private.worker_featured_due(credential_hash, j, t) $$;

CREATE OR REPLACE FUNCTION public.svc_worker_commit_featured(
  credential_hash text, j uuid, t uuid, b text, candidates jsonb
)
RETURNS jsonb LANGUAGE sql SET search_path = ''
AS $$ SELECT private.worker_commit_featured(credential_hash, j, t, b, candidates) $$;

REVOKE ALL ON FUNCTION public.competitor_candidate_add(uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.competitor_candidate_remove(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.competitor_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competitor_candidate_add(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competitor_candidate_remove(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competitor_candidates(uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.worker_featured_due(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.worker_commit_featured(text,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.svc_worker_featured_due(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.svc_worker_commit_featured(text,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.worker_featured_due(text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.worker_commit_featured(text,uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.svc_worker_featured_due(text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.svc_worker_commit_featured(text,uuid,uuid,text,jsonb) TO service_role;
