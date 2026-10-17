-- Owner console review batch C, permissions and audit
-- (docs/reviews/2026-10-13-owner-console-review.md, findings 6, 8, 18 and 19;
-- finding 5 is the admin-users Edge Function, in the same PR).
--
-- 1. Deleting a workspace no longer deletes its audit rows. They are
--    detached: workspace_id becomes null and former_workspace_id keeps the
--    id, the way billing_events is already detached. Impersonations, plan
--    changes and grants made by the owner outlive the workspace. The
--    append-only guard yields to that one update and no longer to a delete.
-- 2. Plan-wide changes leave an audit row (workspace null, target 'plan'),
--    from a trigger on public.plans, so the toggle, the limits dialog and any
--    later path are all covered. promote_platform_reader records itself.
-- 3. promote_platform_reader is executable by authenticated only, not
--    PUBLIC (the function itself already refused non-admins).
-- 4. admin_audit(null) is refused like any limit outside 1-500.
-- 5. grant_pack's idempotency key is scoped to the workspace: the same note
--    on another workspace is a new grant, not a silent no-op, and the audit
--    row is written only when a grant is made.
-- 6. The owner's free-text notes move out of the tenant-readable columns
--    (subscriptions.provider_ref, usage_grants.provider_ref) into
--    private.admin_notes, which no tenant role can read. Existing notes are
--    copied there first, then removed from those columns.

-- ---- 1. audit rows outlive their workspace ----

alter table public.audit_events add column former_workspace_id uuid;

-- Shared by comment_reviews, topic_reviews and audit_events. Replaced whole,
-- from 20260917100000_delete_workspace.sql. Reviews are still deleted with
-- their workspace; an audit row is only ever detached, and nothing else on it
-- may change.
create or replace function private.reject_review_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_setting('app.deleting_workspace', true) is not null
     and current_setting('app.deleting_workspace', true) = old.workspace_id::text then
    if tg_table_name <> 'audit_events' then
      if tg_op = 'DELETE' then return old; end if;
    elsif tg_op = 'UPDATE' then
      if new.workspace_id is null
         and old.former_workspace_id is null
         and new.former_workspace_id = old.workspace_id
         and (new.id, new.actor_id, new.action, new.target_type, new.target_id, new.created_at)
             is not distinct from
             (old.id, old.actor_id, old.action, old.target_type, old.target_id, old.created_at) then
        return new;
      end if;
    end if;
  end if;
  raise exception 'comment_reviews_is_append_only' using errcode='0A000';
end $$;

-- ---- 6. the owner's notes, kept where only the platform can read them ----

create table private.admin_notes (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: a note outlives its workspace, like the audit row.
  workspace_id uuid,
  subject text not null check (subject in ('plan', 'pack')),
  -- The plan key for a plan note, the usage_grants id for a pack note.
  ref text,
  note text not null check (length(note) >= 1),
  actor_id uuid,
  created_at timestamptz not null default now()
);
revoke all on private.admin_notes from public, anon, authenticated;

insert into private.admin_notes(workspace_id, subject, ref, note, created_at)
select s.workspace_id, 'plan', s.plan_key, s.provider_ref, coalesce(s.period_start, now())
  from public.subscriptions s
 where s.provider = 'admin' and s.provider_ref is not null and s.provider_ref <> '';
update public.subscriptions set provider_ref = null
 where provider = 'admin' and provider_ref is not null;

insert into private.admin_notes(workspace_id, subject, ref, note, created_at)
select g.workspace_id, 'pack', g.id::text, g.provider_ref, g.granted_at
  from public.usage_grants g
 where g.source = 'admin' and g.provider_ref is not null and g.provider_ref <> '';
-- The same key grant_pack builds from now on. It stays unique: the old key
-- was unique across all workspaces, so it is unique within each one.
update public.usage_grants
   set provider_ref = workspace_id::text || ':' || md5(provider_ref)
 where source = 'admin' and provider_ref is not null;

-- ---- delete_workspace: detach the audit trail instead of deleting it ----
-- From the current definition (supabase/schema/current.sql); one line changes.
create or replace function public.delete_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid; my_home uuid; begin
  me := auth.uid();
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.workspaces where id = w) then
    raise exception 'not_found' using errcode='P0002'; end if;
  -- Three refusals before any row moves.
  if exists (select 1 from public.memberships m where m.workspace_id = w and m.user_id = me and m.role = 'workspace_owner')
     and (select count(*) from public.memberships m where m.user_id = me and m.role = 'workspace_owner') <= 1 then
    raise exception 'last_workspace' using errcode='55000'; end if;
  if exists (select 1 from public.subscriptions s where s.billing_workspace_id = w and s.workspace_id <> w) then
    raise exception 'billing_root' using errcode='55000'; end if;
  -- A client workspace's own row copies provider/status from its billing
  -- root (create_workspace_impl, apply_billing_event): checking it here
  -- without this guard would refuse every client of a Paddle-paying root,
  -- not just the root itself. billing_workspace_id is null exactly on the
  -- workspace that bills itself — the same test set_workspace_plan's own
  -- Paddle refusal reaches via private.billing_root(w) = w.
  if exists (select 1 from public.subscriptions s where s.workspace_id = w and s.billing_workspace_id is null and s.provider = 'paddle' and s.status in ('active','past_due')) then
    raise exception 'paddle_subscription_active' using errcode='55000'; end if;

  -- Opens the append-only guard for this workspace's rows, this transaction only.
  perform set_config('app.deleting_workspace', w::text, true);

  -- Leaves first. The order is the FK graph of the migrated schema.
  -- billing_events is detached, not deleted: the column is nullable and the
  -- webhook trail (what Paddle told this database, and when) must survive a
  -- chargeback dispute raised after the workspace is gone.
  update private.billing_events set workspace_id = null where workspace_id = w;
  delete from private.worker_credentials where workspace_id = w;
  delete from public.sentiment_predictions where workspace_id = w;
  delete from public.topic_predictions where workspace_id = w;
  delete from public.comment_reviews where workspace_id = w;
  delete from public.topic_reviews where workspace_id = w;
  delete from public.comment_annotations where workspace_id = w;
  delete from public.analysis_runs where workspace_id = w;
  delete from private.oauth_states where workspace_id = w;
  delete from private.oauth_connections where workspace_id = w;
  delete from private.job_batches where job_id in (select id from public.jobs where workspace_id = w);
  delete from public.jobs where workspace_id = w;
  delete from public.sync_runs where workspace_id = w;
  delete from public.video_selections where workspace_id = w;
  delete from public.comments where workspace_id = w;
  delete from public.videos where workspace_id = w;
  delete from public.channels where workspace_id = w;
  delete from public.clients where workspace_id = w;
  delete from public.imports where workspace_id = w;
  delete from public.workspace_topics where workspace_id = w;
  delete from public.usage_events where workspace_id = w;
  delete from public.usage_grants where workspace_id = w;
  delete from public.worker_seen where workspace_id = w;
  delete from public.memberships where workspace_id = w;
  delete from public.subscriptions where workspace_id = w;
  -- The audit trail is detached, not deleted: who impersonated, who set a
  -- plan, who granted a pack must survive the workspace (review finding 6).
  update public.audit_events set workspace_id = null, former_workspace_id = w where workspace_id = w;
  delete from public.workspaces where id = w;

  -- The act outlives the rows: recorded on the admin's own home.
  my_home := private.owner_plan_workspace(me);
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (my_home, me, 'workspace_deleted', 'workspace', w::text);
end $$;

-- ---- 4. admin_audit: a null limit is refused, and a deleted workspace says so ----
create or replace function public.admin_audit(p_limit integer default 100)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid_limit' using errcode='22023'; end if;
  return query
    select jsonb_build_object(
      'id', a.id, 'workspace_id', a.workspace_id,
      'workspace_name', coalesce(w.name, case when a.former_workspace_id is not null then 'Deleted workspace' else 'Platform' end),
      'former_workspace_id', a.former_workspace_id,
      'actor_id', a.actor_id, 'actor_email', u.email,
      'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'created_at', to_jsonb(a.created_at))
    from public.audit_events a
    left join public.workspaces w on w.id = a.workspace_id
    left join auth.users u on u.id = a.actor_id
    order by a.created_at desc
    limit p_limit;
end $$;

-- ---- 2. plan-wide changes leave a row ----
create function private.audit_plan_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new is distinct from old then
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (null, auth.uid(), 'plan_updated', 'plan', new.key);
  end if;
  return new;
end $$;
revoke all on function private.audit_plan_change() from public, anon, authenticated;
create trigger plans_audited after update on public.plans
  for each row execute function private.audit_plan_change();

-- ---- 2 and 3. promote_platform_reader: recorded, and not PUBLIC ----
create or replace function public.promote_platform_reader(w uuid, c uuid) returns void
language plpgsql security definer set search_path='' as $$
declare conn record; begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501'; end if;
  select id, encrypted_tokens, key_version, granted_scopes, connected_by into conn
    from private.oauth_connections
   where workspace_id = w and channel_id = c and status = 'connected'
   order by id desc limit 1;
  if not found then raise exception 'channel_not_connected' using errcode='22023'; end if;
  update private.platform_reader set status = 'retired', retired_at = now()
   where status = 'active';
  insert into private.platform_reader(connection_id, encrypted_tokens, key_version,
                                      granted_scopes, connected_by)
  values (conn.id, conn.encrypted_tokens, conn.key_version, conn.granted_scopes,
          conn.connected_by);
  -- Platform-wide, so no workspace: its owner has no reason to read it.
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (null, auth.uid(), 'platform_reader_promoted', 'channel', c::text);
end $$;
revoke all on function public.promote_platform_reader(uuid, uuid) from public, anon;
grant execute on function public.promote_platform_reader(uuid, uuid) to authenticated;

-- ---- 5 and 6. grant_pack: a workspace-scoped key, a private note ----
create or replace function public.grant_pack(w uuid, kind text, units integer, note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ref text; g uuid; begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  -- The note is the retry key: the same note on the same workspace returns
  -- the first grant. Scoped to the workspace, so another workspace's note
  -- never swallows this grant, and hashed, so the workspace's members, who
  -- can read usage_grants, never read the owner's words.
  if note is not null then
    ref := w::text || ':' || md5(note);
    perform pg_advisory_xact_lock(hashtextextended('grant_pack:' || ref, 0));
    select id into g from public.usage_grants where source = 'admin' and provider_ref = ref;
    if found then return g; end if;
  end if;
  g := private.grant_units(w, kind, units, 'admin', ref);
  -- Written only once a grant exists.
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'pack_granted', 'usage_grant', kind || ':' || units);
  if note is not null and note <> '' then
    insert into private.admin_notes(workspace_id, subject, ref, note, actor_id)
    values (w, 'pack', g::text, note, auth.uid());
  end if;
  return g;
end $$;

-- ---- 6. set_workspace_plan: the note goes to admin_notes, not the subscription ----
-- From the current definition; provider_ref is no longer the note, and the
-- Paddle-override audit row no longer carries it (owners read their audit).
create or replace function public.set_workspace_plan(w uuid, plan text, months integer default 1, note text default null, override boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  root uuid;
  p_start timestamptz := now();
  p_end timestamptz;
  live record;
  on_paddle boolean := false;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.plans where key = plan) then raise exception 'unknown_plan' using errcode='22023'; end if;
  if months < 1 or months > 1200 then raise exception 'invalid_months' using errcode='22023'; end if;
  p_end := p_start + make_interval(months => months);
  root := coalesce(private.billing_root(w), w);
  select s.provider, s.status into live from public.subscriptions s where s.workspace_id = root;
  on_paddle := found and live.provider = 'paddle' and live.status in ('active','past_due');
  if on_paddle and not override then
    raise exception 'paddle_subscription_active' using errcode='55000'; end if;
  if note is not null and note <> '' then
    insert into private.admin_notes(workspace_id, subject, ref, note, actor_id)
    values (w, 'plan', plan, note, auth.uid());
  end if;
  if on_paddle then
    update public.subscriptions
       set plan_key = plan, status = 'active', period_start = p_start, period_end = p_end
     where workspace_id = root or billing_workspace_id = root;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (w, auth.uid(), 'plan_set', 'plan', plan);
    return private.usage_summary_unchecked(w);
  end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref)
  values (root, plan, 'active', p_start, p_end, 'admin', null)
  on conflict (workspace_id) do update
    set plan_key = excluded.plan_key, status = 'active',
        period_start = excluded.period_start, period_end = excluded.period_end,
        provider = 'admin', provider_ref = null, cancel_at_period_end = false;
  -- Every client workspace billing through root copied its subscription row
  -- from the root at creation (private.create_workspace_impl); keep those
  -- copies in step rather than letting them read stale terms.
  update public.subscriptions
     set plan_key = plan, status = 'active',
         period_start = p_start, period_end = p_end,
         provider = 'admin', provider_ref = null, cancel_at_period_end = false
   where billing_workspace_id = root;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'plan_set', 'plan', plan);
  return private.usage_summary_unchecked(w);
end $$;
