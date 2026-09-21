/**
 * Workspace sharing between accounts (public.memberships) with roles 'analyst'
 * and 'viewer', bounded by plan limits (plans.members_limit), and platform
 * admin oversight across all workspaces.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-00000000000a";
const OWNER = "10000000-0000-4000-8000-00000000000b";
const ALICE = "10000000-0000-4000-8000-00000000000c";
const BOB = "10000000-0000-4000-8000-00000000000d";
const STRANGER = "10000000-0000-4000-8000-00000000000e";

let db: PGlite;
let ownerWs: string;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

const bootstrap = async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);

  await db.exec(
    `create function public.__pgrst_probe() returns int language sql as 'select 42';
     create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
     create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`,
  );

  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

  await db.exec("reset role");
  // Seed users with emails
  await db.query(
    "insert into auth.users(id, email) values ($1, $2), ($3, $4), ($5, $6), ($7, $8), ($9, $10)",
    [
      ADMIN,
      "admin@sentiment.internal",
      OWNER,
      "owner@example.com",
      ALICE,
      "alice@example.com",
      BOB,
      "bob@example.com",
      STRANGER,
      "stranger@example.com",
    ],
  );

  // Set ADMIN as platform admin
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);

  // OWNER has their bootstrap workspace created by on_auth_user_created trigger
  const wsRes = await db.query<{ id: string }>(
    "select id from workspaces where created_by=$1 order by created_at limit 1",
    [OWNER],
  );
  ownerWs = wsRes.rows[0].id;
  await db.query("update workspaces set name='Owner Workspace' where id=$1", [
    ownerWs,
  ]);

  // Update subscription for ownerWs with creator_plus plan (members_limit: 2)
  await db.query(
    "update subscriptions set plan_key='creator_plus', status='active' where workspace_id=$1",
    [ownerWs],
  );
};

interface WorkspaceAccountsResult {
  workspace_id: string;
  members_limit: number;
  total_members: number;
  can_manage: boolean;
  accounts: Array<{
    user_id: string;
    email: string;
    role: string;
    is_owner: boolean;
    joined_at: string;
  }>;
}

interface ShareResult {
  ok: boolean;
  action: string;
  user_id: string;
  role: string;
}

interface UnshareResult {
  ok: boolean;
  user_id: string;
}

interface UpdateRoleResult {
  ok: boolean;
  user_id: string;
  role: string;
}

describe("workspace sharing and platform admin oversight", () => {
  beforeAll(bootstrap);

  it("lists workspace accounts and plan limits for the owner", async () => {
    await as(OWNER);
    const res = await db.query<{
      list_workspace_accounts: WorkspaceAccountsResult;
    }>("select list_workspace_accounts($1)", [ownerWs]);
    const data = res.rows[0].list_workspace_accounts;
    expect(data.workspace_id).toBe(ownerWs);
    expect(data.members_limit).toBe(2);
    expect(data.total_members).toBe(1);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].user_id).toBe(OWNER);
    expect(data.accounts[0].email).toBe("owner@example.com");
    expect(data.accounts[0].role).toBe("workspace_owner");
    expect(data.accounts[0].is_owner).toBe(true);
  });

  it("stranger is forbidden from listing or sharing workspace", async () => {
    await as(STRANGER);
    await expect(
      db.query("select list_workspace_accounts($1)", [ownerWs]),
    ).rejects.toThrow(/forbidden/);

    await expect(
      db.query("select share_workspace($1, 'alice@example.com', 'analyst')", [
        ownerWs,
      ]),
    ).rejects.toThrow(/forbidden/);
  });

  it("owner shares workspace with alice as analyst", async () => {
    await as(OWNER);
    const res = await db.query<{ share_workspace: ShareResult }>(
      "select share_workspace($1, 'alice@example.com', 'analyst')",
      [ownerWs],
    );
    expect(res.rows[0].share_workspace).toMatchObject({
      ok: true,
      action: "added",
      user_id: ALICE,
      role: "analyst",
    });

    // Check membership and audit
    await db.exec("reset role");
    const mem = await db.query<{ role: string }>(
      "select * from memberships where workspace_id=$1 and user_id=$2",
      [ownerWs, ALICE],
    );
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0].role).toBe("analyst");

    const audit = await db.query<{ target_id: string }>(
      "select * from audit_events where workspace_id=$1 and action='workspace_shared'",
      [ownerWs],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].target_id).toBe(ALICE);
  });

  it("owner updates alice role to viewer via re-sharing or update_workspace_account_role", async () => {
    await as(OWNER);
    // Updating role via share_workspace
    const res = await db.query<{ share_workspace: ShareResult }>(
      "select share_workspace($1, 'alice@example.com', 'viewer')",
      [ownerWs],
    );
    expect(res.rows[0].share_workspace).toMatchObject({
      ok: true,
      action: "updated",
      user_id: ALICE,
      role: "viewer",
    });

    // Or via update_workspace_account_role
    const res2 = await db.query<{
      update_workspace_account_role: UpdateRoleResult;
    }>("select update_workspace_account_role($1, $2, 'analyst')", [
      ownerWs,
      ALICE,
    ]);
    expect(res2.rows[0].update_workspace_account_role).toMatchObject({
      ok: true,
      user_id: ALICE,
      role: "analyst",
    });
  });

  it("refuses sharing with a non-existent email", async () => {
    await as(OWNER);
    await expect(
      db.query("select share_workspace($1, 'nobody@example.com', 'viewer')", [
        ownerWs,
      ]),
    ).rejects.toThrow(/user_not_found/);
  });

  it("refuses sharing beyond plan members_limit", async () => {
    // Current members: OWNER (1), ALICE (2). Limit on creator_plus is 2.
    await as(OWNER);
    await expect(
      db.query("select share_workspace($1, 'bob@example.com', 'viewer')", [
        ownerWs,
      ]),
    ).rejects.toThrow(/members_limit_reached/);
  });

  it("cannot remove or modify workspace owner", async () => {
    await as(OWNER);
    await expect(
      db.query("select unshare_workspace($1, $2)", [ownerWs, OWNER]),
    ).rejects.toThrow(/cannot_remove_owner/);

    await expect(
      db.query("select update_workspace_account_role($1, $2, 'viewer')", [
        ownerWs,
        OWNER,
      ]),
    ).rejects.toThrow(/cannot_modify_owner/);
  });

  it("owner unshares workspace with alice", async () => {
    await as(OWNER);
    const res = await db.query<{ unshare_workspace: UnshareResult }>(
      "select unshare_workspace($1, $2)",
      [ownerWs, ALICE],
    );
    expect(res.rows[0].unshare_workspace).toMatchObject({
      ok: true,
      user_id: ALICE,
    });

    await db.exec("reset role");
    const mem = await db.query(
      "select * from memberships where workspace_id=$1 and user_id=$2",
      [ownerWs, ALICE],
    );
    expect(mem.rows).toHaveLength(0);

    const audit = await db.query<{ target_id: string }>(
      "select * from audit_events where workspace_id=$1 and action='workspace_unshared'",
      [ownerWs],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].target_id).toBe(ALICE);
  });

  it("platform admin has view and oversight access across member workspaces", async () => {
    // ADMIN is not in memberships of ownerWs
    await db.exec("reset role");
    const inMem = await db.query(
      "select * from memberships where workspace_id=$1 and user_id=$2",
      [ownerWs, ADMIN],
    );
    expect(inMem.rows).toHaveLength(0);

    // Switch to ADMIN session
    await as(ADMIN);

    // 1. Admin can read the workspace row directly via RLS
    const wsRead = await db.query<{ id: string; name: string }>(
      "select id, name from workspaces where id=$1",
      [ownerWs],
    );
    expect(wsRead.rows).toHaveLength(1);
    expect(wsRead.rows[0].name).toBe("Owner Workspace");

    // 2. Admin can call list_workspace_accounts
    const accRes = await db.query<{
      list_workspace_accounts: WorkspaceAccountsResult;
    }>("select list_workspace_accounts($1)", [ownerWs]);
    expect(accRes.rows[0].list_workspace_accounts.workspace_id).toBe(ownerWs);

    // 3. Admin can call share_workspace and unshare_workspace on behalf of platform
    const shareRes = await db.query<{ share_workspace: ShareResult }>(
      "select share_workspace($1, 'bob@example.com', 'analyst')",
      [ownerWs],
    );
    expect(shareRes.rows[0].share_workspace.ok).toBe(true);

    const unshareRes = await db.query<{ unshare_workspace: UnshareResult }>(
      "select unshare_workspace($1, $2)",
      [ownerWs, BOB],
    );
    expect(unshareRes.rows[0].unshare_workspace.ok).toBe(true);

    // 4. Admin can call dashboard_snapshot and workspace_ops_snapshot on member's workspace
    const dashRes = await db.query<{
      dashboard_snapshot: Record<string, unknown>;
    }>("select dashboard_snapshot($1)", [ownerWs]);
    expect(dashRes.rows[0].dashboard_snapshot).toBeDefined();

    const opsRes = await db.query<{
      workspace_ops_snapshot: Record<string, unknown>;
    }>("select workspace_ops_snapshot($1)", [ownerWs]);
    expect(opsRes.rows[0].workspace_ops_snapshot).toBeDefined();
  });
});
