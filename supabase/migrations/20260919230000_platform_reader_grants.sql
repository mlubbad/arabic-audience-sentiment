-- 1. Grant service_role select and update on private.platform_reader so the
-- worker gateway can retrieve and store renewed reader tokens.
grant select, update on private.platform_reader to service_role;

-- 2. schedule_due_work includes public channels (status = 'public_unverified')
-- alongside connected ones (status = 'connected') so recurring synchronization
-- catalogues and collects videos for all active channels.
create or replace function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; a int := 0; cat int; begin
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status in ('connected', 'public_unverified') loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    if jsonb_array_length(private.due_videos(w, ch.id)) > 0 then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $$;
