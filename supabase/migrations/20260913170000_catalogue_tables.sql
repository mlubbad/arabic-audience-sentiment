-- G1-G4: the remaining tables from section 7. All are written by the server,
-- so tenants read and never write.

-- G1. One row per collection run. Its status vocabulary is the jobs one, so a
-- run that stopped early cannot be recorded as having finished. coverage_summary
-- holds exactly what the dashboard projection reads.
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  channel_id uuid not null,
  mode text not null check (mode in ('discover','collect','analyse','import')),
  source text not null check (length(source) between 1 and 80),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null check (status in ('running','succeeded','partial','failed','blocked')),
  error_code text check (error_code is null or length(error_code) between 1 and 80),
  coverage_summary jsonb not null default '{}',
  unique (workspace_id, id),
  foreign key (workspace_id, channel_id) references public.channels (workspace_id, id),
  -- A finished run has an end; a running one does not claim to.
  check ((status = 'running') = (ended_at is null))
);
create index sync_runs_recent on public.sync_runs(workspace_id, channel_id, started_at desc);

-- G2. file_hash is unique per workspace so re-uploading the same file returns
-- the earlier result instead of importing twice. The path must begin with the
-- workspace id, because that leading segment is what the private bucket policy
-- checks.
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  file_path text not null,
  file_hash text not null check (length(file_hash) between 8 and 128),
  schema_version text not null check (length(schema_version) between 1 and 40),
  status text not null check (status in ('pending','running','succeeded','partial','failed','rejected')),
  row_counts jsonb not null default '{}',
  rejected_rows_path text,
  created_at timestamptz not null default now(),
  unique (workspace_id, file_hash),
  check (split_part(file_path, '/', 1) = workspace_id::text),
  check (rejected_rows_path is null or split_part(rejected_rows_path, '/', 1) = workspace_id::text)
);

-- G3. Who did what, and nothing else: the fields are short and bounded so a
-- comment body cannot be parked in the audit trail.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid references auth.users(id),
  action text not null check (length(action) between 1 and 60),
  target_type text not null check (length(target_type) between 1 and 40),
  target_id text check (target_id is null or length(target_id) <= 200),
  created_at timestamptz not null default now()
);
create index audit_events_recent on public.audit_events(workspace_id, created_at desc);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.reject_review_mutation();

-- G4. Comment types and the like. Kept apart from sentiment on purpose, and
-- every row states where it came from rather than leaving it to be assumed.
create table public.comment_annotations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  comment_id uuid not null,
  kind text not null check (length(kind) between 1 and 40),
  value text not null check (length(value) between 1 and 200),
  method text not null check (method in ('rules','model','manual')),
  version text not null check (length(version) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (workspace_id, comment_id, kind, version),
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id)
);

do $$ declare t text; begin
  foreach t in array array['sync_runs','imports','comment_annotations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_role(workspace_id))', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- The audit trail answers to owners only: an analyst has no business reading
-- who did what.
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
create policy owner_read on public.audit_events for select to authenticated
  using (private.has_role(workspace_id, array['workspace_owner']));
grant all on public.audit_events to service_role;
