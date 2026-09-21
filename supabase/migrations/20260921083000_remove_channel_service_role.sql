-- Allow service_role as well as workspace_owner to invoke remove_channel_impl.
-- Enables operational and administrative cleanup of misconfigured or blocked channels.

create or replace function private.remove_channel_impl(w uuid, c uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503';
  end if;

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

grant execute on function private.remove_channel_impl(uuid, uuid) to service_role;
grant execute on function public.remove_channel(uuid, uuid) to service_role;
