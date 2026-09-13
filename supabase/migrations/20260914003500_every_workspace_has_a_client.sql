-- No user could ever connect a channel.
--
-- oauth_start and register_channel both require a client_id that belongs to the
-- workspace, and nothing in the product ever inserted into public.clients — not
-- create_workspace, not the personal-workspace trigger, not any RPC. A user
-- could sign up, get a workspace, and then reach a wall with no way past it.
-- The connect step was unreachable from the moment the schema was written.
--
-- A workspace now gets a client when it is created, named after it. For a
-- single creator the distinction never surfaces: their workspace is their
-- client. For an agency it is the seam that lets one workspace hold several
-- brands, which is why the column exists at all.
--
-- Backfilled, because the two workspaces that already exist were created before
-- this and would otherwise stay permanently unable to connect anything.

create or replace function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into public.workspaces(name,created_by) values(workspace_name,auth.uid()) returning id into w;
  insert into public.memberships values(w,auth.uid(),'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,workspace_name);
  return w;
end $$;

create or replace function private.bootstrap_personal_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  insert into public.workspaces(name,created_by) values('مساحة العمل الشخصية',new.id) returning id into w;
  insert into public.memberships values(w,new.id,'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,'مساحة العمل الشخصية');
  return new;
end $$;

insert into public.clients(workspace_id,name)
select w.id, w.name from public.workspaces w
where not exists (select 1 from public.clients c where c.workspace_id = w.id);
