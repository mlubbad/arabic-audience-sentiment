# Platform Worker Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One worker credential that serves every workspace, so a workspace created by a signup is collected without an operator minting, installing and restarting anything.

**Architecture:** One new migration makes `private.worker_credentials.workspace_id` nullable (null = platform), teaches `worker_workspace` to return null for such a row, and rebuilds — whole, from their current bodies — the six functions that read that value: `claim_job` claims across workspaces oldest-first and records the poll as a sighting of every workspace, `worker_job` returns the job's own workspace and refuses only a scoped mismatch, the three grant functions and `worker_tick` accept null as "any". Registration and retirement gain platform variants; the scoped retire guard allows an empty keep once a platform credential is active. Nothing above SQL changes.

**Tech Stack:** Postgres (Supabase migration, PGlite for tests via `npm run test:db`), Vitest. No TypeScript, Python or UI changes.

**Spec:** [docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md](../specs/2026-09-18-platform-worker-credential-design.md)

## Global Constraints

- Node is pinned: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` in every shell.
- Migrations are immutable once applied: everything here goes into the ONE new file `supabase/migrations/20260918130000_a_platform_worker_credential.sql`. Every `create or replace` is a whole-body rewrite from the function's current definition, named in a comment at each, never from an older draft (`docs/coordination/ACTIVE.md` records a replace that silently reverted a later change).
- The wire contract, `supabase/functions/**`, `workers/python/**`, `scripts/worker-service.sh`, `packages/contracts/**` and `apps/web/**` are not touched.
- Run `npx vitest run supabase/tests/platform_worker.test.ts` after every SQL change, and the neighbouring suites (`worker_gateway`, `worker_catalogue`, `lease_recovery`, `workspace_lifecycle`) before every commit; the whole `npm run check` before the last one.
- Another session is active in this checkout: stage by exact pathspec only (`git add <paths> && git commit … -- <paths>`), never `-A`/`.`; check `git status --short` for a foreign staged `A`/`M` first.
- Nothing in this plan pushes the migration to the live project or registers a live credential: those steps are handed to the operator in Task 5.

---

### Task 1: The schema, the platform registration and retirement, and the suite's bootstrap

**Files:**
- Create: `supabase/migrations/20260918130000_a_platform_worker_credential.sql`
- Create: `supabase/tests/platform_worker.test.ts`

**Interfaces:**
- Produces: `public.svc_register_platform_worker_credential(secret text, label text) returns uuid`; `public.svc_retire_platform_worker_credentials(keep uuid[]) returns integer`; the column `private.worker_credentials.workspace_id` nullable. Later tasks' tests use `PLATFORM` (a 64-char bearer hash) registered here in `beforeAll`.

- [ ] **Step 1: Write the suite's bootstrap and the registration/retirement tests**

Create `supabase/tests/platform_worker.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Three workspaces: A and B have a channel and a job each, C has nothing at
// all — it is there to prove a platform poll is a sighting of every
// workspace, not only of the ones with work.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const ownerA = "10000000-0000-4000-8000-00000000000a";
const ownerB = "10000000-0000-4000-8000-00000000000b";
const ownerC = "10000000-0000-4000-8000-00000000000c";
// The gateway hashes the bearer; only the digest reaches the database. The
// platform one is registered through the service-role door, so its digest
// is sha256 of the secret below rather than a literal.
const CRED_A = "a".repeat(64);
const PLATFORM_SECRET = "platform-" + "p".repeat(55);
const PLATFORM_REVOKED = "r".repeat(64);
let PLATFORM = "";
let platformId = "";
let db: PGlite;

const claim = (cred: string) =>
  db.query<{ id: string; lease_token: string; workspace_id: string }>(
    "select * from private.worker_claim($1)",
    [cred],
  );
const scalar = async (sql: string, p: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, p)).rows[0].n;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

describe("a platform worker credential", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      ownerA,
      ownerB,
      ownerC,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$4),($2,'B',$5),($3,'C',$6)",
      [A, B, C, ownerA, ownerB, ownerC],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner'),($5,$6,'workspace_owner')",
      [A, ownerA, B, ownerB, C, ownerC],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    // A's channel is public and unconnected; B's is connected with a grant,
    // so the grant path can be exercised against B.
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A')",
      [A],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,'UC_B','connected')",
      [B],
    );
    await db.query(
      `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
       values ($1,$1,$2,'\\x00','k1','{}','connected')`,
      [B, ownerB],
    );
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,channels_limit) values ('t',100,0,2)",
    );
    for (const w of [A, B, C])
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'a',$2)",
      [CRED_A, A],
    );
    // Registered through the door the operator will use, not inserted.
    platformId = (
      await db.query<{ id: string }>(
        "select public.svc_register_platform_worker_credential($1,'platform') as id",
        [PLATFORM_SECRET],
      )
    ).rows[0].id;
    PLATFORM = (
      await db.query<{ h: string }>(
        "select encode(extensions.digest($1,'sha256'),'hex') as h",
        [PLATFORM_SECRET],
      )
    ).rows[0].h;
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id,status) values ($1,'old-platform',null,'revoked')",
      [PLATFORM_REVOKED],
    );
    // A's job is older than B's, so oldest-first is observable.
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key,not_before) values ($1,$1,'collect','a1',now()-interval '2 minutes')",
      [A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key,not_before) values ($1,$1,'collect','b1',now()-interval '1 minute')",
      [B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("registers a platform credential with no workspace, and refuses a weak secret", async () => {
    const row = await db.query<{ workspace_id: string | null; status: string }>(
      "select workspace_id, status from private.worker_credentials where id=$1",
      [platformId],
    );
    expect(row.rows[0]).toEqual({ workspace_id: null, status: "active" });
    await expect(
      db.query(
        "select public.svc_register_platform_worker_credential($1,'short')",
        ["s".repeat(31)],
      ),
    ).rejects.toThrow(/weak_credential/);
  });

  it("retires every platform credential but the ones named, and refuses an empty or foreign keep", async () => {
    const second = (
      await db.query<{ id: string }>(
        "select public.svc_register_platform_worker_credential($1,'platform-2') as id",
        ["second-" + "q".repeat(57)],
      )
    ).rows[0].id;
    await expect(
      db.query("select public.svc_retire_platform_worker_credentials($1::uuid[])", [[]]),
    ).rejects.toThrow(/keep_at_least_one/);
    // A scoped credential's id is not a platform credential.
    const scoped = (
      await db.query<{ id: string }>(
        "select id from private.worker_credentials where token_hash=$1",
        [CRED_A],
      )
    ).rows[0].id;
    await expect(
      db.query("select public.svc_retire_platform_worker_credentials($1::uuid[])", [
        [scoped],
      ]),
    ).rejects.toThrow(/unknown_credential/);
    expect(
      await scalar(
        "select public.svc_retire_platform_worker_credentials($1::uuid[]) as n",
        [[platformId]],
      ),
    ).toBe(1);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from private.worker_credentials where id=$1",
          [second],
        )
      ).rows[0].status,
    ).toBe("revoked");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: the suite fails in `beforeAll` — `function public.svc_register_platform_worker_credential(unknown, unknown) does not exist` (the migration is not written yet).

- [ ] **Step 3: Write the migration's first part**

Create `supabase/migrations/20260918130000_a_platform_worker_credential.sql`:

```sql
-- A platform worker credential: one credential that serves every workspace.
--
-- Until now a credential was bound to one workspace (20260913160000), and the
-- worker held one per tenant: WORKER_CREDENTIAL and WORKER_CREDENTIAL_WS2 in
-- scripts/worker-service.sh. A workspace a signup created had none, so nothing
-- ever asked for its jobs, and its page said «الجمع متوقّف الآن» for good. On
-- 2026-09-17 a deleted test workspace also took one of the two live
-- credentials with it (delete_workspace deletes them by workspace), and the
-- worker has been refused on it every minute since.
--
-- The wire contract never carries a workspace — the worker sends a bearer and
-- job ids and the database derives the tenant — so a credential that resolves
-- to "any workspace" needs no gateway, worker, contract or UI change. Design:
-- docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md.
--
-- Every create or replace below is a whole-body rewrite from the function's
-- current definition (the file named at each), with only the named change.

-- 1. The column. Null is a platform credential.
alter table private.worker_credentials alter column workspace_id drop not null;
comment on column private.worker_credentials.workspace_id is
  'The one workspace this credential may touch; null is a platform credential, which serves every workspace.';

-- 2. Registration and retirement of platform credentials, beside the scoped
-- doors of 20260914012000 and 20260915160000. Service role only, like them.
create function private.register_platform_worker_credential(secret text, label text)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; begin
  if secret is null or length(secret) < 32 then
    raise exception 'weak_credential' using errcode='22023'; end if;
  insert into private.worker_credentials(token_hash, label, workspace_id)
  values (encode(extensions.digest(secret, 'sha256'), 'hex'), label, null)
  returning private.worker_credentials.id into new_id;
  return new_id;
end $$;

create function public.svc_register_platform_worker_credential(secret text, label text)
returns uuid language sql security invoker set search_path='' as $$
  select private.register_platform_worker_credential(secret, label)
$$;

-- Retires every platform credential except the ones named. Revoked, not
-- deleted, as for scoped ones: the row stays as the record that a credential
-- existed. keep_at_least_one on an empty list — a platform with no worker at
-- all is a decision to make explicitly, in a console, not by passing nothing.
create function private.retire_platform_worker_credentials(keep uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
  if keep is null or cardinality(keep) = 0 then
    raise exception 'keep_at_least_one' using errcode='22023'; end if;
  if exists(select 1 from unnest(keep) k(id)
             where not exists(select 1 from private.worker_credentials c
                               where c.id = k.id and c.workspace_id is null and c.status = 'active')) then
    raise exception 'unknown_credential' using errcode='23503'; end if;
  update private.worker_credentials
     set status = 'revoked'
   where workspace_id is null and status = 'active' and not (id = any(keep));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.svc_retire_platform_worker_credentials(keep uuid[])
returns integer language sql security invoker set search_path='' as $$
  select private.retire_platform_worker_credentials(keep)
$$;

revoke all on function private.register_platform_worker_credential(text,text),
  public.svc_register_platform_worker_credential(text,text),
  private.retire_platform_worker_credentials(uuid[]),
  public.svc_retire_platform_worker_credentials(uuid[]) from public, anon, authenticated;
grant execute on function private.register_platform_worker_credential(text,text),
  public.svc_register_platform_worker_credential(text,text),
  private.retire_platform_worker_credentials(uuid[]),
  public.svc_retire_platform_worker_credentials(uuid[]) to service_role;
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Run the neighbouring suites**

Run: `npx vitest run supabase/tests/worker_gateway.test.ts supabase/tests/worker_catalogue.test.ts supabase/tests/lease_recovery.test.ts supabase/tests/workspace_lifecycle.test.ts`
Expected: all green — the column change and two new doors touch nothing they read.

- [ ] **Step 6: Commit**

```bash
git status --short
git add supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts && git commit -m "A platform worker credential, part 1: the column may be null, and the service-role doors to register and retire one" -- supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts
```

---

### Task 2: The credential resolves to every workspace: `worker_workspace`, `claim_job`, and the sighting

**Files:**
- Modify: `supabase/migrations/20260918130000_a_platform_worker_credential.sql` (append)
- Modify: `supabase/tests/platform_worker.test.ts` (append cases inside the `describe`)

**Interfaces:**
- Consumes: `PLATFORM`, `CRED_A`, the two seeded jobs, workspace C from Task 1.
- Produces: `private.worker_workspace(token_hash)` returns null for a platform credential; `private.claim_job(w uuid)` treats null as every workspace and records `public.worker_seen` for every workspace on that poll. Task 3's tests claim through these.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe`, after the retirement case:

```ts
  it("claims across workspaces, oldest due first, and each claim is the job's own workspace", async () => {
    const first = await claim(PLATFORM);
    expect(first.rows[0].workspace_id).toBe(A);
    expect(
      (
        await db.query<{ dedupe_key: string }>(
          "select dedupe_key from jobs where id=$1",
          [first.rows[0].id],
        )
      ).rows[0].dedupe_key,
    ).toBe("a1");
    const second = await claim(PLATFORM);
    expect(second.rows[0].workspace_id).toBe(B);
    // Nothing left: a third poll is an empty answer, not an error.
    expect((await claim(PLATFORM)).rows).toHaveLength(0);
  });

  it("records the poll as a sighting of every workspace, including one with no work at all", async () => {
    const seen = await db.query<{ workspace_id: string }>(
      "select workspace_id from worker_seen where last_seen_at > now() - interval '1 minute' order by workspace_id",
    );
    expect(seen.rows.map((r) => r.workspace_id)).toEqual([A, B, C]);
  });

  it("reads as connected on a workspace that has no scoped credential of its own", async () => {
    await as(ownerB);
    const snap = (
      await db.query<{ dashboard_snapshot: { sync: { worker: { connected: boolean } } } }>(
        "select public.dashboard_snapshot($1)",
        [B],
      )
    ).rows[0].dashboard_snapshot;
    expect(snap.sync.worker.connected).toBe(true);
    await db.exec("reset role");
  });

  it("refuses a revoked platform credential like any other", async () => {
    await expect(claim(PLATFORM_REVOKED)).rejects.toThrow(
      /invalid_worker_credential/,
    );
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: the first new case fails with `invalid_worker_credential` — today `worker_workspace` reads a null workspace as "no row". (The sighting and connected cases fail after it for the same reason; the revoked case passes already and is kept as the guard that stays.)

- [ ] **Step 3: Append the rewrites to the migration**

```sql
-- 3. worker_workspace, rebuilt from 20260913160000:22-30 with one change: an
-- active row whose workspace is null is a platform credential and answers
-- null, so "no row" and "a platform row" are told apart by a marker rather
-- than by the workspace being null.
create or replace function private.worker_workspace(token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; matched boolean; begin
  update private.worker_credentials c set last_seen_at = now()
  where c.token_hash = worker_workspace.token_hash and c.status = 'active'
  returning c.workspace_id, true into w, matched;
  if matched is not true then raise exception 'invalid_worker_credential' using errcode='42501'; end if;
  return w;
end $$;

-- 4. claim_job, rebuilt from 20260915132000:4-60 with two changes: a null
-- workspace means every workspace — the reaper and the claim read
-- (w is null or workspace_id = w), and the order across tenants is the one
-- already used within one, oldest due first — and the sighting a platform
-- poll leaves is a row for every workspace, because that poll asked them
-- all. worker_seen's own comment stays true: the last time a worker asked
-- this workspace for work.
create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  if w is null then
    insert into public.worker_seen(workspace_id, last_seen_at)
    select ws.id, now() from public.workspaces ws
    on conflict (workspace_id) do update set last_seen_at = now();
  else
    insert into public.worker_seen(workspace_id, last_seen_at)
    values (w, now())
    on conflict (workspace_id) do update set last_seen_at = now();
  end if;

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where (w is null or workspace_id = w)
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case when j.status = 'running' then 1 else 0 end,
      not_before = case
        when j.status = 'running' and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where (w is null or q.workspace_id = w)
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by q.not_before, q.id
      for update skip locked limit 1)
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id,
          case when claimed.type in ('discover','collect','analyse','import')
               then claimed.type else 'collect' end,
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Neighbouring suites, then commit**

Run: `npx vitest run supabase/tests/worker_gateway.test.ts supabase/tests/worker_catalogue.test.ts supabase/tests/lease_recovery.test.ts supabase/tests/workspace_lifecycle.test.ts supabase/tests/end_to_end.test.ts`
Expected: green — a scoped credential's `claim_job(w)` is the same text with `w` non-null.

```bash
git add supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts && git commit -m "A platform worker credential, part 2: worker_workspace answers null for it, the claim crosses workspaces oldest-first, and the poll is a sighting of every workspace" -- supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts
```

---

### Task 3: The job-bound guard, the grant functions and the tick accept null as "any"

**Files:**
- Modify: `supabase/migrations/20260918130000_a_platform_worker_credential.sql` (append)
- Modify: `supabase/tests/platform_worker.test.ts` (append)

**Interfaces:**
- Consumes: the two jobs claimed in Task 2 (A's and B's, both `running` under the platform credential), B's connected channel and connection.
- Produces: `private.worker_job(token_hash, j, t)` returns the job's own workspace for a platform credential; `worker_channel_grant`, `worker_store_grant`, `worker_mark_revoked`, `worker_tick` accept it.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe`:

```ts
  it("heartbeats and finishes another workspace's job with the platform credential, while a scoped one is still refused", async () => {
    const b = (
      await db.query<{ id: string; lease_token: string }>(
        "select id, lease_token from jobs where workspace_id=$1 and status='running'",
        [B],
      )
    ).rows[0];
    await expect(
      db.query("select private.worker_heartbeat($1,$2,$3)", [CRED_A, b.id, b.lease_token]),
    ).rejects.toThrow(/forbidden/);
    await db.query("select private.worker_heartbeat($1,$2,$3)", [PLATFORM, b.id, b.lease_token]);
    // The grant path: B's connection for B's job, opened by the platform
    // credential; and a renewed grant written back.
    const grant = await db.query<{ connection_id: string }>(
      "select connection_id from private.worker_channel_grant($1,$2)",
      [PLATFORM, b.id],
    );
    expect(grant.rows).toHaveLength(1);
    await db.query("select private.worker_store_grant($1,$2,$3)", [
      PLATFORM,
      grant.rows[0].connection_id,
      "\\x01",
    ]);
    expect(
      (
        await db.query<{ t: string }>(
          "select encode(encrypted_tokens,'hex') as t from private.oauth_connections where id=$1",
          [grant.rows[0].connection_id],
        )
      ).rows[0].t,
    ).toBe("01");
    await db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
      PLATFORM,
      b.id,
      b.lease_token,
      "succeeded",
      null,
    ]);
    expect(
      (
        await db.query<{ status: string }>("select status from jobs where id=$1", [b.id])
      ).rows[0].status,
    ).toBe("succeeded");
  });

  it("answers channel_not_connected for a job whose channel has no grant, and marks a revoked one", async () => {
    const a = (
      await db.query<{ id: string }>(
        "select id from jobs where workspace_id=$1 and status='running'",
        [A],
      )
    ).rows[0];
    await expect(
      db.query("select * from private.worker_channel_grant($1,$2)", [PLATFORM, a.id]),
    ).rejects.toThrow(/channel_not_connected/);
    const b = (
      await db.query<{ id: string }>("select id from jobs where workspace_id=$1", [B])
    ).rows[0];
    await db.query("select private.worker_mark_revoked($1,$2)", [PLATFORM, b.id]);
    expect(
      (
        await db.query<{ status: string }>("select status from channels where id=$1", [B])
      ).rows[0].status,
    ).toBe("reconnect_required");
  });

  it("ticks every active workspace for the platform credential, and one for a scoped one", async () => {
    const platform = (
      await db.query<{ t: { discover: number; collect: number; workspaces: number } }>(
        "select private.worker_tick($1) as t",
        [PLATFORM],
      )
    ).rows[0].t;
    // Three active subscriptions; nothing is due — B's channel was just
    // marked for reconnection and A's is not connected.
    expect(platform).toEqual({ discover: 0, collect: 0, workspaces: 3 });
    const scoped = (
      await db.query<{ t: Record<string, number> }>("select private.worker_tick($1) as t", [CRED_A])
    ).rows[0].t;
    expect(scoped).toEqual({ discover: 0, collect: 0 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: the heartbeat case fails — `worker_job` compares `owner <> w` with `w` null and raises `forbidden` (`null <> uuid` is null, and the current text refuses on that path); the tick case fails on the missing `workspaces` key.

- [ ] **Step 3: Append the rewrites**

```sql
-- 5. worker_job, rebuilt from 20260913160000:40-49 with one change: a
-- platform credential (w null) owns any live lease, and the function
-- answers the job's own workspace either way — which for a scoped
-- credential is w, as before. Every job-bound call keys on that value.
create or replace function private.worker_job(token_hash text, j uuid, t uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; owner uuid; begin
  w := private.worker_workspace(token_hash);
  select workspace_id into owner from public.jobs
  where id = j and lease_token = t and status = 'running' and lease_expires_at > now();
  if owner is null then raise exception 'lease_lost' using errcode='40001'; end if;
  if w is not null and owner <> w then raise exception 'forbidden' using errcode='42501'; end if;
  return owner;
end $$;

-- 6. The three grant functions, rebuilt from 20260914010000:14-50, each
-- with one change: (w is null or …) where the credential's workspace was
-- compared. The job still binds the connection to its own workspace.
create or replace function private.worker_channel_grant(token_hash text, j uuid)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  w := private.worker_workspace(token_hash);
  return query
  select c.id, c.encrypted_tokens, c.key_version
  from private.oauth_connections c
  join public.jobs jb on jb.channel_id = c.channel_id and jb.workspace_id = c.workspace_id
  where jb.id = j and (w is null or c.workspace_id = w) and c.status = 'connected'
  order by c.id desc limit 1;
  if not found then
    raise exception 'channel_not_connected' using errcode='42501'; end if;
end $$;

create or replace function private.worker_store_grant(token_hash text, connection uuid, tokens bytea)
returns void language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  w := private.worker_workspace(token_hash);
  update private.oauth_connections set encrypted_tokens = tokens
  where id = connection and (w is null or workspace_id = w) and status = 'connected';
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
end $$;

create or replace function private.worker_mark_revoked(token_hash text, j uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare w uuid; ch uuid; begin
  w := private.worker_workspace(token_hash);
  select channel_id into ch from public.jobs where id = j and (w is null or workspace_id = w);
  if ch is null then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.oauth_mark_revoked(ch);
end $$;

-- 7. worker_tick, rebuilt from 20260915132000:196-199 (a one-line sql
-- function) as plpgsql: a scoped credential still answers
-- schedule_due_work(w); a platform one walks the workspaces of active
-- subscriptions — the set schedule_all() walks for pg_cron — and answers
-- the two totals plus how many it walked.
create or replace function private.worker_tick(token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; ws uuid; r jsonb; d int := 0; k int := 0; n int := 0; begin
  w := private.worker_workspace(token_hash);
  if w is not null then return private.schedule_due_work(w); end if;
  for ws in select workspace_id from public.subscriptions where status = 'active' loop
    r := private.schedule_due_work(ws);
    d := d + coalesce((r->>'discover')::int, 0);
    k := k + coalesce((r->>'collect')::int, 0);
    n := n + 1;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k, 'workspaces', n);
end $$;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Neighbouring suites, then commit**

Run: `npx vitest run supabase/tests/worker_gateway.test.ts supabase/tests/worker_catalogue.test.ts supabase/tests/worker_video_counts.test.ts supabase/tests/worker_topics.test.ts supabase/tests/oauth.test.ts supabase/tests/lease_recovery.test.ts supabase/tests/end_to_end.test.ts`
Expected: green.

```bash
git add supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts && git commit -m "A platform worker credential, part 3: the lease guard answers the job's own workspace, the grant functions and the tick read null as every workspace" -- supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts
```

---

### Task 4: A workspace's last scoped credential may go once a platform one is live; the deploy notes say so

**Files:**
- Modify: `supabase/migrations/20260918130000_a_platform_worker_credential.sql` (append)
- Modify: `supabase/tests/platform_worker.test.ts` (append)
- Modify: `workers/deploy/README.md:24-45`
- Modify: `.env.example:33`

**Interfaces:**
- Consumes: `svc_retire_worker_credentials(w, keep)` (`20260915160000`), `CRED_A`, `platformId` (revoked in Task 1's retirement case; a fresh platform credential is registered inside the test).

- [ ] **Step 1: Write the failing test**

Append inside the `describe`:

```ts
  it("lets a workspace's last scoped credential go while a platform credential is live, and not otherwise", async () => {
    // Task 1's retirement case revoked every platform credential; register a
    // live one, then the scoped door may empty the workspace.
    await db.query(
      "select public.svc_register_platform_worker_credential($1,'platform-3')",
      ["third-" + "z".repeat(58)],
    );
    expect(
      await scalar("select public.svc_retire_worker_credentials($1,$2::uuid[]) as n", [A, []]),
    ).toBe(1);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from private.worker_credentials where token_hash=$1",
          [CRED_A],
        )
      ).rows[0].status,
    ).toBe("revoked");
    // With no platform credential live, the old guard holds.
    await db.query(
      "update private.worker_credentials set status='revoked' where workspace_id is null",
    );
    await expect(
      db.query("select public.svc_retire_worker_credentials($1,$2::uuid[])", [B, []]),
    ).rejects.toThrow(/keep_at_least_one/);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run supabase/tests/platform_worker.test.ts`
Expected: the new case fails at the first `svc_retire_worker_credentials(A, '{}')` with `keep_at_least_one`.

- [ ] **Step 3: Append the guard's rewrite**

```sql
-- 8. retire_worker_credentials, rebuilt from 20260915160000:12-30 with one
-- change: an empty keep is refused only while no platform credential is
-- active — with one, a workspace without a scoped credential is not a
-- workspace without a worker, which is what the guard protects.
create or replace function private.retire_worker_credentials(w uuid, keep uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
  if not exists(select 1 from public.workspaces where id = w) then
    raise exception 'invalid_workspace' using errcode='23503'; end if;
  keep := coalesce(keep, '{}'::uuid[]);
  if cardinality(keep) = 0
     and not exists(select 1 from private.worker_credentials c
                     where c.workspace_id is null and c.status = 'active') then
    raise exception 'keep_at_least_one' using errcode='22023'; end if;
  if exists(select 1 from unnest(keep) k(id)
             where not exists(select 1 from private.worker_credentials c
                               where c.id = k.id and c.workspace_id = w and c.status = 'active')) then
    raise exception 'unknown_credential' using errcode='23503'; end if;
  update private.worker_credentials
     set status = 'revoked'
   where workspace_id = w and status = 'active' and not (id = any(keep));
  get diagnostics n = row_count;
  return n;
end $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run supabase/tests/platform_worker.test.ts supabase/tests/worker_catalogue.test.ts`
Expected: 10 passed in the new suite; `worker_catalogue`'s own `keep_at_least_one` case still passes (its database has no platform credential).

- [ ] **Step 5: Update the deploy notes**

In `workers/deploy/README.md`, replace the paragraph beginning "A credential is scoped to one workspace" through the sentence ending "rather than one process each." with:

```markdown
The credential is the only kind of secret on the host. It is not a Supabase
key and cannot read anything but the queue it is allowed to see.

Since 2026-09-18 the recommended credential is a **platform** one: registered
with `svc_register_platform_worker_credential(secret, label)`, it serves every
workspace — a workspace created by a signup is collected without anyone
touching the host. The claim takes the oldest due job across workspaces, and
every poll counts as a sighting of every workspace, so each tenant's operations
page reads «متصل» while the worker is up. One `WORKER_CREDENTIAL` is the whole
configuration. Rotate with register-then-`svc_retire_platform_worker_credentials(keep)`.

A **scoped** credential (`svc_register_worker_credential(secret, label,
workspace)`) still works and still sees only its workspace. To run several
scoped ones from one machine, list them comma-separated:

```
WORKER_CREDENTIAL=<first>,<second>
```

The loop takes them in turn rather than in order, so a busy tenant cannot
starve a quiet one, and a round counts as idle only when every credential came
back empty. The classifier is loaded once and shared, which is the reason to
run one worker over several tenants rather than one process each.
```

In `.env.example`, replace the line `WORKER_CREDENTIAL=` with:

```
# The worker's bearer: a platform credential (svc_register_platform_worker_credential)
# serves every workspace; a scoped one serves its own. Comma-separate several.
WORKER_CREDENTIAL=
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts workers/deploy/README.md .env.example && git commit -m "A platform worker credential, part 4: a workspace's last scoped credential may be retired while a platform one is live; the deploy notes recommend the platform credential" -- supabase/migrations/20260918130000_a_platform_worker_credential.sql supabase/tests/platform_worker.test.ts workers/deploy/README.md .env.example
```

---

### Task 5: The whole check, the mutation proofs, the records, the push, and the operator's hand-off

**Files:**
- Modify: `docs/decisions.md` (append), `docs/progress.md` (append), `docs/verification.md` (append), `docs/coordination/ACTIVE.md` (append a rollout-pending note)

- [ ] **Step 1: Mutation proofs, each reverted straight after**

Back the migration up first (`cp` to the scratch directory — never `git checkout` a file with uncommitted work). Then, one at a time:

1. In `claim_job`, change `where (w is null or q.workspace_id = w)` to `where q.workspace_id = w` and run the suite: the claim case must fail (nothing claimed for a null `w`). Restore from the backup; run again: green.
2. In `claim_job`, change the platform sighting to the single-row form (`values (w, now())`): the sighting case must fail (no rows: `w` is null) and the connected case must fail. Restore; green.
3. In `worker_job`, change `return owner;` to `return w;`: the end-to-end case must fail at the catalogue commit (`null value in column "workspace_id" of relation "videos"`). Restore; green. (Reverting the comparison alone raises nothing — `null <> uuid` is null — so it is not the mutation to run.)

Record the three results (red → restored green) for `docs/verification.md`.

- [ ] **Step 2: The full check**

Run: `npm run check`
Expected: exit 0 — lint, format, typecheck, `check:functions`, unit, db (now 33 files), worker, build, secrets. Note the tallies.

- [ ] **Step 3: Write the records**

Append to `docs/decisions.md`:

```markdown
## 2026-09-18 — the worker's credential is the platform's, not a workspace's

A worker credential was bound to one workspace (`20260913160000`), and the launchd worker
carried one per tenant. That model needed an operator for every new workspace and broke
silently when a deleted test workspace took a live credential with it on 2026-09-17. Chosen,
over provisioning a scoped credential per signup: a **platform credential** —
`worker_credentials.workspace_id` null — that resolves to every workspace
(`20260918130000`). The claim crosses workspaces oldest-first, the poll is a sighting of every
workspace in the `worker_seen` table that already decides «متصل», and the job-bound guard
answers the job's own workspace. Nothing above SQL changed: the wire contract never carried a
workspace, which is exactly what made this a one-migration change. Scoped credentials keep
working; a workspace's last one may be retired once a platform one is live. Design:
`docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md`.
```

Append to `docs/progress.md` a dated entry (`## 2026-09-18 — a platform worker credential`) naming the migration, the four commits, the suite (10 cases), what the operator still has to run (Step 5 below), and that the live host is unchanged until then.

Append to `docs/verification.md` a dated entry with: the suite's red-then-green per task (the exact first failure of each), the three mutation results, the `npm run check` tallies, and "not verified: a live claim by a platform credential — needs the rollout in the operator's hand".

Append to `docs/coordination/ACTIVE.md`, under the pending notes: the migration `20260918130000` is committed and NOT pushed; the rollout steps are in `docs/progress.md`'s entry; the two scoped credentials on the live project (`rotated-2026-09-15`, id `14b189c0-…`, and the deleted workspace's, gone) are to be replaced by the platform one.

- [ ] **Step 4: Commit and push**

```bash
git status --short
git commit -m "Record the platform worker credential: the decision, the suite's red-then-green and mutation proofs, the check tallies, and the rollout left to the operator" -- docs/decisions.md docs/progress.md docs/verification.md docs/coordination/ACTIVE.md
git push origin main
```

- [ ] **Step 5: Hand the rollout to the operator**

Give these, in order, as commands to run (the guard refuses them from the session):

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" && npx supabase db push --linked
```

```bash
openssl rand -hex 32
```

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && npx supabase db query --linked "select public.svc_register_platform_worker_credential('<the 64 hex characters>', 'platform-2026-09-18')"
```

Then in `.env.local`: `WORKER_CREDENTIAL=<the same 64 hex characters>`, and delete the `WORKER_CREDENTIAL_WS2` and `WORKER_CREDENTIAL_NEW_ID` lines. Then:

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && sh scripts/worker-service-update.sh
```

```bash
tail -5 "$HOME/Library/Application Support/sentiment-worker/service.log"
```

Expected in the log: `worker up, model=camelbert-da, tenants=1, topics=gemini`, then within a minute a claim of the `creator_plus` tenant's discover job and no `invalid_worker_credential`. Finally retire the owner's scoped credential:

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && npx supabase db query --linked "select public.svc_retire_worker_credentials('d0c3b9fc-b813-439e-a32b-71dd357f0bb4', '{}')"
```
