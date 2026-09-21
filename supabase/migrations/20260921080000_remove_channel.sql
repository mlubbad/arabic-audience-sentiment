-- Allows workspace owners to remove / disconnect an attached channel completely.
-- Cancels any scheduled/running jobs for the channel and purges channel-specific data,
-- freeing the workspace to register a different channel or platform.

create or replace function private.remove_channel_impl(w uuid, c uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;

  perform set_config('app.deleting_workspace', w::text, true);

  delete from private.job_batches where job_id in (select id from public.jobs where workspace_id = w and channel_id = c);
  delete from public.jobs where workspace_id = w and channel_id = c;

  delete from public.sentiment_predictions where workspace_id = w and comment_id in (
    select c2.id from public.comments c2 join public.videos v on v.id = c2.video_id where v.workspace_id = w and v.channel_id = c
  );
  delete from public.topic_predictions where workspace_id = w and comment_id in (
    select c2.id from public.comments c2 join public.videos v on v.id = c2.video_id where v.workspace_id = w and v.channel_id = c
  );
  delete from public.comment_reviews where workspace_id = w and comment_id in (
    select c2.id from public.comments c2 join public.videos v on v.id = c2.video_id where v.workspace_id = w and v.channel_id = c
  );
  delete from public.topic_reviews where workspace_id = w and comment_id in (
    select c2.id from public.comments c2 join public.videos v on v.id = c2.video_id where v.workspace_id = w and v.channel_id = c
  );
  delete from public.comment_annotations where workspace_id = w and comment_id in (
    select c2.id from public.comments c2 join public.videos v on v.id = c2.video_id where v.workspace_id = w and v.channel_id = c
  );
  delete from public.comments where workspace_id = w and video_id in (
    select v.id from public.videos v where v.workspace_id = w and v.channel_id = c
  );
  delete from public.video_selections where workspace_id = w and channel_id = c;
  delete from public.videos where workspace_id = w and channel_id = c;
  delete from public.sync_runs where workspace_id = w and channel_id = c;
  delete from private.oauth_connections where workspace_id = w and channel_id = c;
  delete from public.channels where workspace_id = w and id = c;
end $$;

create or replace function public.remove_channel(w uuid, c uuid) returns void
language sql security invoker set search_path='' as $$
  select private.remove_channel_impl(w, c);
$$;

revoke all on function private.remove_channel_impl(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.remove_channel_impl(uuid, uuid) to authenticated;

revoke all on function public.remove_channel(uuid, uuid) from public;
grant execute on function public.remove_channel(uuid, uuid) to authenticated;
