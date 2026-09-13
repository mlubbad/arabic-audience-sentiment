-- channels.active_analysis_key decides which prediction is a comment's
-- effective label. It was read in three places and written by nothing, so a
-- workspace could store a full set of correct predictions and still show every
-- comment as unanalysed — which is exactly what happened once real comments
-- were collected.
--
-- Adopted on first success only. A workspace with no active analysis has
-- nothing to lose by taking the one that just ran; a workspace that already
-- has one must not have it swapped underneath it because somebody ran an
-- experiment, which would silently relabel every figure on the dashboard.
-- Changing it afterwards is a deliberate act and will need its own entry point.
create function private.adopt_first_analysis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.channels c
     set active_analysis_key = k.analysis_key
    from (
      select v.channel_id, n.workspace_id, min(n.analysis_key) as analysis_key
        from new_predictions n
        join public.comments cm
          on cm.workspace_id = n.workspace_id and cm.id = n.comment_id
        join public.videos v
          on v.workspace_id = n.workspace_id and v.id = cm.video_id
       where n.status = 'succeeded'
       group by v.channel_id, n.workspace_id
      -- One analysis per adoption. A batch carrying two different keys for the
      -- same channel is ambiguous, and picking one would be a coin toss that
      -- decides what every label on the dashboard means.
      having count(distinct n.analysis_key) = 1
    ) k
   where c.workspace_id = k.workspace_id
     and c.id = k.channel_id
     and c.active_analysis_key is null;
  return null;
end $$;

revoke all on function private.adopt_first_analysis() from public, anon, authenticated;

create trigger adopt_first_analysis
after insert on public.sentiment_predictions
referencing new table as new_predictions
for each statement execute function private.adopt_first_analysis();
