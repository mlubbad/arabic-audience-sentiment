-- Migration: 20260922220000_dashboard_aggregation_covering_indexes.sql
-- High-performance covering composite indexes for dashboard aggregation CTEs
-- and author name trigram search indexing.

-- 1. Covering composite index for active sentiment predictions join in dashboard_aggregates_impl & dashboard_comments_impl
CREATE INDEX IF NOT EXISTS sentiment_preds_active_covering_idx
  ON public.sentiment_predictions (workspace_id, analysis_key, comment_id, content_hash, label)
  WHERE status = 'succeeded';

-- 2. Covering composite index for active topic predictions join in dashboard_aggregates_impl & dashboard_comments_impl
CREATE INDEX IF NOT EXISTS topic_preds_active_covering_idx
  ON public.topic_predictions (workspace_id, classification_key, comment_id, content_hash, topic_key)
  WHERE status = 'succeeded';

-- 3. Trigram GIN index on author_name to accelerate multi-field text search (text_raw OR author_name)
DO $ext$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  CREATE INDEX IF NOT EXISTS comments_author_name_trgm_idx
    ON public.comments
    USING gin (author_name extensions.gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$ext$;
