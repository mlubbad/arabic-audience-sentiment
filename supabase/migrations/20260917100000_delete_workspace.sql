-- Retiring stays a handover; deleting is the operator's own door.
--
-- retire_workspace hands a workspace to the platform owner and keeps every
-- row. When the caller IS the platform owner that is a no-op dressed as a
-- transfer — the membership is deleted and re-inserted for the same person
-- and the page says it "moved to the operator". Refused now.
--
-- delete_workspace is the one real deletion, admin-only. It refuses a
-- workspace other workspaces bill under, one Paddle is still billing, and the
-- caller's own last workspace; then deletes leaves-first through the FK
-- graph (read from the migrated schema — nothing here is on delete cascade
-- except worker_seen, so every table is named), in one transaction, and
-- records the act on the admin's own home workspace, where it outlives the
-- rows it removed.

-- retire_workspace: the body below is 20260917090000's, with one refusal
-- added at the top. Replaced whole, from the current definition — a
-- create or replace built from an older draft silently drops later lines.
create or replace function public.retire_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid; keeper uuid; keeper_home uuid; ch record; begin
  me := auth.uid();
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  keeper := private.platform_owner();
  if keeper is null then raise exception 'no_platform_owner' using errcode='55000'; end if;
  -- The owner has nobody to hand a workspace to but themself.
  if me = keeper then raise exception 'owner_cannot_retire' using errcode='55000'; end if;
  -- A person always keeps one workspace to stand in; the product has no
  -- signed-in state without one.
  if (select count(*) from public.memberships m
       where m.user_id = me and m.role = 'workspace_owner') <= 1 then
    raise exception 'last_workspace' using errcode='55000'; end if;
  keeper_home := private.owner_plan_workspace(keeper);

  -- The grant leaves with the person who gave it; scheduled work stops.
  for ch in select id from public.channels where workspace_id = w loop
    update public.channels set status = 'disconnected' where id = ch.id;
    update private.oauth_connections set status = 'revoked' where channel_id = ch.id;
    update public.jobs set status = 'cancelled', error_code = 'disconnected'
     where channel_id = ch.id and status in ('queued','running');
  end loop;

  -- Membership moves whole: everyone out, the keeper in as owner.
  delete from public.memberships where workspace_id = w;
  insert into public.memberships(workspace_id, user_id, role) values (w, keeper, 'workspace_owner');

  -- Billing follows the keeper's root; the rows stay where they are.
  update public.subscriptions s
     set plan_key = k.plan_key, status = k.status, period_start = k.period_start,
         period_end = k.period_end, provider = k.provider, provider_ref = k.provider_ref,
         provider_customer_ref = k.provider_customer_ref, billing_interval = k.billing_interval,
         cancel_at_period_end = false, billing_workspace_id = keeper_home
    from public.subscriptions k
   where s.workspace_id = w and k.workspace_id = keeper_home;

  update public.workspaces
     set created_by = keeper, retired_from = me, retired_at = now()
   where id = w;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, me, 'workspace_retired', 'workspace', me::text);
end $$;

-- What a deletion would destroy, counted, so the dialog says "٤٢٠ تعليقًا"
-- and not "some data".
create function public.admin_workspace_footprint(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'channels',    (select count(*) from public.channels where workspace_id = w),
    'videos',      (select count(*) from public.videos where workspace_id = w),
    'comments',    (select count(*) from public.comments where workspace_id = w),
    'predictions', (select count(*) from public.sentiment_predictions where workspace_id = w)
                 + (select count(*) from public.topic_predictions where workspace_id = w),
    'reviews',     (select count(*) from public.comment_reviews where workspace_id = w)
                 + (select count(*) from public.topic_reviews where workspace_id = w),
    'members',     (select count(*) from public.memberships where workspace_id = w));
end $$;
revoke all on function public.admin_workspace_footprint(uuid) from public, anon;
grant execute on function public.admin_workspace_footprint(uuid) to authenticated;

-- The three append-only tables (comment_reviews, topic_reviews, audit_events)
-- refuse every update and delete, so a privileged role cannot quietly rewrite
-- a review history. Deleting a whole workspace is the one act that must remove
-- them — and it is neither quiet (recorded on the admin's home, below) nor a
-- rewrite. So the guard yields to exactly that act and nothing else: a DELETE
-- of a row whose workspace is the one delete_workspace is deleting right now,
-- known through a transaction-local setting that delete_workspace sets; a
-- service-role session could set it by hand, which is the same trust the
-- service key already carries — no tenant role can, since none holds DELETE
-- on these tables. UPDATEs are still always refused. Replaced whole, from
-- the current one-line body in 20260912185902_foundation.sql.
create or replace function private.reject_review_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.deleting_workspace', true) is not null
     and current_setting('app.deleting_workspace', true) = old.workspace_id::text then
    return old;
  end if;
  raise exception 'comment_reviews_is_append_only' using errcode='0A000';
end $$;

create function public.delete_workspace(w uuid) returns void
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
  delete from public.audit_events where workspace_id = w;
  delete from public.workspaces where id = w;

  -- The act outlives the rows: recorded on the admin's own home.
  my_home := private.owner_plan_workspace(me);
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (my_home, me, 'workspace_deleted', 'workspace', w::text);
end $$;
revoke all on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;
