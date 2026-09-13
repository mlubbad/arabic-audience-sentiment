# Schema lane kickoff — for Gemini

You are the **schema lane**. You own the database and nothing else.

Read this file completely before running anything. Then read `AGENTS.md`,
`docs/coordination/README.md`, and section 7 (النموذج المنطقي للبيانات) and section 8
(العزل وحجز المهام) of `docs/Codex-Build-Handoff.md`.

---

## 1. Where you work

| | |
| --- | --- |
| Worktree | `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/schema` |
| Branch | `codex/agent-c-schema` |
| You own | `supabase/**` and `docs/agent-reports/schema.md` |
| You must not touch | `apps/web/**`, `packages/contracts/**`, `workers/python/**`, `tests/e2e/**`, root config, `package.json`, lockfiles, any other lane's report |

Other agents are working in this repository at the same time. Never edit another
worktree, never check out or reset another branch, and never `git stash` or `git clean`
anything you did not create.

At the start of every session run these three and check the output before editing:

```
pwd
git branch --show-current
git status --short
```

`pwd` must end in `/worktrees/schema` and the branch must be `codex/agent-c-schema`.
If either is wrong, stop and say so rather than continuing.

### Start here — paste these five, in order

```
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/schema
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
git branch --show-current                      # must print codex/agent-c-schema
git merge --no-edit codex/coordination-integration   # pick up other lanes' shared changes
npm run test:db                                # must print 18 passed before you change anything
```

If any of those five does not do what it says, stop and report it rather than continuing.

**Pre-flight already done for you (2026-09-13).** Before you were handed this lane, the whole
loop was walked through once end to end: a second migration file plus its test was created,
`npm run test:db` applied both in filename order and passed, `npm run typecheck` passed, the
ownership guard accepted `supabase/**` and refused a file outside it, and the pre-commit hook
was confirmed wired to your branch. The probe files were then deleted. So the pattern in
section 5 is known to work — if it fails for you, something you changed is the cause, not the
setup.

---

## 2. Environment — read this, it will bite you otherwise

This machine's default Node is v26, but the project pins **Node 22.14.0** and
`.npmrc` sets `engine-strict=true`, so anything else refuses to install. Put the pinned
Node first on `PATH` in **every** shell command you run:

```
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
```

Verify once per session with `node -v` — it must print `v22.14.0`.

Your worktree already has `node_modules` installed. If it does not, run `npm ci`.

**Docker is not required.** Database tests run against embedded PostgreSQL (PGlite).

---

## 3. The only commands you need

```
npm run test:db          # your main loop — migrations + RLS, ~2 seconds
npm run typecheck        # the SQL tests are TypeScript, so this must pass
node scripts/check-ownership.mjs schema    # run before every commit
```

**Do not run `npm run test:e2e` or `npm run dev`.** The browser suite uses a shared port
and another lane is using it. If you think you need it, say so instead of running it.

`npm run check` runs the whole repository including other lanes' tests. You may run it,
but `npm run test:db` is the loop you should work in.

---

## 4. Rules that outrank convenience

1. **Never edit `supabase/migrations/20260912185902_foundation.sql`.** It is applied
   elsewhere and other branches depend on it. Every change is a **new** file named
   `supabase/migrations/<UTC timestamp>_<short_name>.sql`, for example
   `20260913120000_add_sync_runs.sql`. The test harness applies all migrations in
   filename order, so ordering is your responsibility.
2. **Tests first.** Write the failing test in `supabase/tests/`, run `npm run test:db`,
   see it fail *for the reason you expect*, then write the migration. If a test passes
   before you write the code, it is testing nothing — fix the test.
3. **Every new table gets row-level security**, in the same shape the baseline migration
   uses. Copy the existing pattern; do not invent a new one.
4. **Tenants never write directly.** Grants are `select` only unless a role-checked RPC
   is the writer. Membership is resolved through `private.has_role(...)`, never from a
   value the caller sent and never from user metadata.
5. **Composite foreign keys.** Any row that belongs to a workspace references its parent
   as `(workspace_id, id)`, so a row in workspace A can never point at workspace B. The
   baseline migration shows this on `videos`, `comments` and `channels`.
6. Never claim anything was verified against a real Supabase project. PGlite runs real
   SQL and real RLS but it is **not** Supabase: no GoTrue, no PostgREST, no Storage HTTP.
   Say "verified in embedded PostgreSQL" and nothing stronger.

---

## 5. Worked example — copy this shape

This is the pattern for every task below. Migration:

```sql
-- supabase/migrations/20260913120000_add_example.sql
create table public.example (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  channel_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, channel_id) references public.channels (workspace_id, id)
);
alter table public.example enable row level security;
revoke all on public.example from anon, authenticated;
grant select on public.example to authenticated;
create policy tenant_read on public.example
  for select to authenticated using (private.has_role(workspace_id));
grant all on public.example to service_role;
```

Test, added to a new file in `supabase/tests/`:

```ts
it("is readable by its own workspace and by nobody else", async () => {
  await user(ownerA);
  expect((await db.query("select id from example")).rows).toHaveLength(1);
  await user(ownerB);
  expect((await db.query("select id from example")).rows).toEqual([]);
});
it("cannot be written directly by a tenant", async () => {
  await user(ownerA);
  await expect(
    db.query("insert into example(workspace_id,channel_id) values ($1,$1)", [A]),
  ).rejects.toThrow();
});
```

`supabase/tests/foundation.test.ts` shows the full harness: how roles are switched with
`user(id)` and `admin()`, and how the fixture workspaces `A` and `B` are seeded. Read it
before writing your first test.

---

## 6. Your tasks, in order

Do them one at a time. Commit each separately. Do not start the next until the previous
one is committed with passing tests.

### G1 — `sync_runs`

Section 7 specifies: `id, workspace_id, channel_id, mode, source, started_at, ended_at,
status, coverage_summary`.

- `status` must be constrained to `running, succeeded, partial, failed, blocked` — the
  same vocabulary the jobs table already uses. A collection that stopped early is
  `partial`, never `succeeded`.
- `coverage_summary` is `jsonb not null default '{}'`.
- `mode` is one of `discover, collect, analyse, import`.
- Composite FK to `channels` on `(workspace_id, channel_id)`.
- Tenant read only; no tenant insert or update.

Tests must cover: own-workspace read, foreign-workspace read returns nothing, direct
insert rejected, a cross-workspace `channel_id` rejected by the composite key, and the
status constraint rejecting an invented value such as `'complete'`.

### G2 — `imports`

Section 7 specifies: `id, workspace_id, file_path, file_hash, schema_version, status,
row_counts, rejected_rows_path`.

- `unique (workspace_id, file_hash)` — section 13 requires that re-uploading the same
  file returns the previous result rather than importing twice. Your test must prove the
  second insert of the same hash fails.
- `status` in `pending, running, succeeded, partial, failed, rejected`.
- `row_counts` is `jsonb not null default '{}'`.
- `file_path` must begin with the workspace UUID, matching the private storage policy in
  the baseline migration. Add a check constraint and test that a path starting with a
  different workspace id is rejected.

### G3 — `audit_events`

Section 7 specifies: `workspace_id, actor_id, action, target_type, target_id,
created_at`, and adds **دون أسرار أو نصوص تعليقات كاملة** — no secrets and no full
comment text.

- Append-only, enforced by a trigger that rejects `update` and `delete`, exactly like
  `comment_reviews` in the baseline migration. Your test must show that even a role which
  bypasses RLS cannot rewrite history.
- Readable only by `workspace_owner`. Use `private.has_role(workspace_id,
  array['workspace_owner'])`. Test that an `analyst` and a `viewer` both read nothing.
- No column may hold free text that could carry a comment body. Keep `action`,
  `target_type` and `target_id` short and constrained.

### G4 — `comment_annotations`

Section 7 specifies: `workspace_id, comment_id, kind, value, method, version`, and
section 9 is explicit that these are **separate from sentiment**.

- `method` in `rules, model, manual` — provenance is required, never assumed.
- Composite FK to `comments` on `(workspace_id, comment_id)`.
- `unique (workspace_id, comment_id, kind, version)`.
- Tests must show an annotation cannot be attached to another workspace's comment, and
  that inserting the same `(comment, kind, version)` twice fails.

---

## 7. Reporting

Write to `docs/agent-reports/schema.md` only. Never edit `docs/progress.md`,
`docs/verification.md`, `docs/decisions.md` or another lane's report.

For each task record: the task id, the base commit, the migration filename, the exact
commands you ran and their **actual** output, and what is still not verified. If a test
failed and you changed the test rather than the code, say so and say why.

If you need something outside your lane — a TypeScript schema, a UI change, a Python
change — **do not make it**. Write a precise request in your report describing the field
names, types, nullability and behaviour you need, and continue with your other tasks.

---

## 8. Before every commit

```
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
npm run test:db
npm run typecheck
node scripts/check-ownership.mjs schema
git add <only your files>
git commit
```

A pre-commit hook runs the ownership guard automatically and will refuse a commit that
touches another lane. If it refuses, **do not work around it** — you have edited
something that is not yours. Undo that change and report it.

Commit only files you own. Never merge into another branch. Never push.
