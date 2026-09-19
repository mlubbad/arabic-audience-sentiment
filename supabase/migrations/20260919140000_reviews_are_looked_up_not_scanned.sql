-- Reviews are looked up, not scanned.
--
-- The dashboard's read judges each comment once per row, and part of that
-- judgement is the human verdict: a correlated lookup of the comment's
-- reviews, filtered by workspace and comment. Neither reviews table carried
-- an index for that shape — only a primary key on an internal id nothing
-- looks up by — so every dashboard read walked both tables from the top,
-- once per comment. At eighteen thousand comments that is eighteen thousand
-- sequential scans per page load, paid by every visitor, growing with the
-- data it is trying to show. Both tables get the index the read actually
-- asks for.
create index comment_reviews_comment
  on public.comment_reviews (workspace_id, comment_id);

create index topic_reviews_comment
  on public.topic_reviews (workspace_id, comment_id);
