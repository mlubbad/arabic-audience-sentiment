-- An imported channel's automatic selection runs the moment its catalogue run
-- finishes, not at the next scheduler tick.
--
-- `private.auto_select_videos` waits for the catalogue run (it selects nothing
-- while a discover job is queued or running). Until now only the scheduler
-- called it, and the scheduler runs once an hour or when the worker is idle:
-- after a bulk import the worker is busy with a hundred catalogue runs, so a
-- channel whose catalogue was in could show no selected video for up to an
-- hour. This trigger calls it as the discover job is marked done, and starts
-- the collection of what it selected in the same step. The scheduler still
-- calls it every tick for the videos published later.

create or replace function private.auto_select_after_catalogue()
returns trigger
language plpgsql security definer set search_path='' as $$
declare
  picked integer;
begin
  -- The selection is a convenience on top of the job's own outcome: a fault
  -- here must not undo the finished run. The scheduler tries again within
  -- the hour.
  begin
    -- Two statements: `has_due_videos` is stable, so within the statement
    -- that selects it would not see the new selections.
    picked := private.auto_select_videos(new.workspace_id, new.channel_id);
    if picked > 0 and private.has_due_videos(new.workspace_id, new.channel_id) then
      perform private.enqueue_scheduled(new.workspace_id, new.channel_id, 'collect');
    end if;
  exception when others then
    raise warning 'auto_select_after_catalogue(%, %): %',
      new.workspace_id, new.channel_id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function private.auto_select_after_catalogue() from public, anon, authenticated;

create trigger jobs_auto_select_after_catalogue
  after update of status on public.jobs
  for each row
  when (new.type = 'discover'
        and old.status in ('queued', 'running')
        and new.status in ('succeeded', 'partial'))
  execute function private.auto_select_after_catalogue();
