create function public.audience_shared_videos(
  p_channel uuid,
  p_other uuid,
  p_limit int default 10
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ch public.channels;
  other public.channels;
  size_a int;
  size_b int;
  shared int;
  result jsonb;
begin
  select * into ch from public.channels where id = p_channel;
  if ch.id is null or not private.has_role(ch.workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.switch_on('audience_overlap') then
    raise exception 'feature_unavailable' using errcode = 'P0001';
  end if;
  if not private.overlap_allowed(ch.workspace_id) then
    raise exception 'plan_feature_unavailable' using errcode = 'P0001';
  end if;

  select * into other from public.channels where id = p_other;
  if other.id is null or other.workspace_id <> ch.workspace_id or other.platform <> ch.platform or other.id = ch.id then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if ch.id < other.id then
    select c.shared into shared
      from private.audience_overlap_cells c
     where c.workspace_id = ch.workspace_id and c.channel_a = ch.id and c.channel_b = other.id;
  else
    select c.shared into shared
      from private.audience_overlap_cells c
     where c.workspace_id = ch.workspace_id and c.channel_a = other.id and c.channel_b = ch.id;
  end if;

  select s.size into size_a from private.audience_sizes s where s.workspace_id=ch.workspace_id and s.channel_id=ch.id;
  select s.size into size_b from private.audience_sizes s where s.workspace_id=ch.workspace_id and s.channel_id=other.id;
  if size_a is null or size_b is null or size_a < 100 or shared is null or shared < 10 then
    return jsonb_build_object('status','below_threshold','videos','[]'::jsonb);
  end if;

  with shared_hashes as materialized (
    select m.member_hash
      from private.audience_members m
     where m.workspace_id=ch.workspace_id and m.channel_id=ch.id and not m.is_suspected_bot
  ), shared_by_video as (
    select v.id video_id, count(distinct av.member_hash)::int shared_commenters
      from shared_hashes h
      join private.audience_member_videos av on av.workspace_id=ch.workspace_id and av.member_hash=h.member_hash
      join public.videos v on v.workspace_id=av.workspace_id and v.id=av.video_id and v.channel_id=other.id
      join private.audience_members bm on bm.workspace_id=av.workspace_id and bm.channel_id=other.id
        and bm.member_hash=av.member_hash and not bm.is_suspected_bot
     group by v.id
  ), audience_by_video as (
    select v.id video_id, count(distinct bm.member_hash)::int video_audience
      from private.audience_members bm
      join private.audience_member_videos av on av.workspace_id=bm.workspace_id and av.member_hash=bm.member_hash
      join public.videos v on v.workspace_id=av.workspace_id and v.id=av.video_id and v.channel_id=bm.channel_id
     where bm.workspace_id=ch.workspace_id and bm.channel_id=other.id and not bm.is_suspected_bot
     group by v.id
  )
  select coalesce(jsonb_agg(x.item order by x.shared_commenters desc, x.affinity desc, x.video_id), '[]'::jsonb)
    into result
    from (
      select v.id video_id, s.shared_commenters,
        round(100 * (s.shared_commenters::numeric / a.video_audience) / (shared::numeric / size_b)) affinity,
        jsonb_build_object('video_id',v.id,'external_video_id',v.external_video_id,'title',v.title,
          'published_at',v.published_at,'shared_commenters',s.shared_commenters,
          'video_audience',a.video_audience,
          'affinity',round(100 * (s.shared_commenters::numeric / a.video_audience) / (shared::numeric / size_b))) item
        from shared_by_video s
        join audience_by_video a on a.video_id=s.video_id
        join public.videos v on v.id=s.video_id and v.workspace_id=ch.workspace_id
       where s.shared_commenters >= 5 and a.video_audience > 0
       order by s.shared_commenters desc, affinity desc, v.id
       limit p_limit
    ) x;
  return jsonb_build_object('status','ready','videos',result);
end $$;
revoke all on function public.audience_shared_videos(uuid,uuid,int) from public, anon;
grant execute on function public.audience_shared_videos(uuid,uuid,int) to authenticated;
