/**
 * Tests for workspace isolation and user impersonation ("الدخول كـ"):
 * 1. my_workspaces() isolates workspaces so platform admins only see their own workspaces by default.
 * 2. my_workspaces(target_user_id) allows platform admins to inspect a target user's workspaces.
 * 3. Non-admins cannot inspect other users' workspaces via my_workspaces.
 * 4. admin_start_impersonation audits and returns target user details.
 * 5. admin_stop_impersonation audits the end of impersonation.
 * 6. Non-admins cannot invoke impersonation RPCs.
 * 7. Admin cannot impersonate themselves.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-00000000000a";
const USER_A = "10000000-0000-4000-8000-00000000000b";
const USER_B = "10000000-0000-4000-8000-00000000000c";

const WS_ADMIN = "20000000-0000-4000-8000-000000000001";
const WS_A1 = "20000000-0000-4000-8000-000000000002";
const WS_A2 = "20000000-0000-4000-8000-000000000003";
const WS_B = "20000000-0000-4000-8000-000000000004";

let db: PGlite;

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
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  }

  await db.exec("reset role");
  // Seed auth users
  await db.query(
    "insert into auth.users(id, email) values ($1, $2), ($3, $4), ($5, $6)",
    [
      ADMIN,
      "admin@sentiment.internal",
      USER_A,
      "user_a@example.com",
      USER_B,
      "user_b@example.com",
    ],
  );

  // Designate ADMIN as platform admin
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);

  // Clear trigger-created default workspaces to assert exact test counts
  await db.query("truncate public.workspaces cascade");

  // Create workspaces
  // ADMIN owns WS_ADMIN
  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'Admin Personal WS', $2)",
    [WS_ADMIN, ADMIN],
  );
  await db.query(
    "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
    [WS_ADMIN, ADMIN],
  );

  // USER_A owns WS_A1 and WS_A2
  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'User A Workspace 1', $2)",
    [WS_A1, USER_A],
  );
  await db.query(
    "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
    [WS_A1, USER_A],
  );

  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'User A Workspace 2', $2)",
    [WS_A2, USER_A],
  );
  await db.query(
    "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
    [WS_A2, USER_A],
  );

  // USER_B owns WS_B
  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'User B Workspace', $2)",
    [WS_B, USER_B],
  );
  await db.query(
    "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
    [WS_B, USER_B],
  );
};

describe("workspace isolation and user impersonation", () => {
  beforeAll(bootstrap);

  it("isolates admin's personal workspaces from other tenant workspaces via my_workspaces()", async () => {
    await as(ADMIN);

    // Call my_workspaces() with no arguments (default personal view)
    const res = await db.query<{ id: string; name: string }>(
      "select id, name from my_workspaces()",
    );

    // Admin should ONLY see WS_ADMIN, not WS_A1, WS_A2, or WS_B!
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe(WS_ADMIN);
    expect(res.rows[0].name).toBe("Admin Personal WS");
  });

  it("returns only User A's workspaces when User A calls my_workspaces()", async () => {
    await as(USER_A);

    const res = await db.query<{ id: string; name: string }>(
      "select id, name from my_workspaces()",
    );

    expect(res.rows).toHaveLength(2);
    const names = res.rows.map((r) => r.name);
    expect(names).toContain("User A Workspace 1");
    expect(names).toContain("User A Workspace 2");
  });

  it("allows platform admin to inspect User A's workspaces via my_workspaces(target_user_id)", async () => {
    await as(ADMIN);

    const res = await db.query<{ id: string; name: string }>(
      "select id, name from my_workspaces($1)",
      [USER_A],
    );

    expect(res.rows).toHaveLength(2);
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(WS_A1);
    expect(ids).toContain(WS_A2);
  });

  it("forbids non-admin from querying another user's workspaces via my_workspaces(target_user_id)", async () => {
    await as(USER_A);

    await expect(
      db.query("select * from my_workspaces($1)", [USER_B]),
    ).rejects.toThrow(/forbidden/);
  });

  it("allows platform admin to start impersonation and writes an audit event", async () => {
    await as(ADMIN);

    const res = await db.query<{
      admin_start_impersonation: {
        target_user_id: string;
        target_email: string;
        started_at: string;
      };
    }>("select admin_start_impersonation($1)", [USER_A]);

    expect(res.rows[0].admin_start_impersonation.target_user_id).toBe(USER_A);
    expect(res.rows[0].admin_start_impersonation.target_email).toBe(
      "user_a@example.com",
    );

    // Verify audit event in public.audit_events
    await db.exec("reset role");
    const audit = await db.query<{
      action: string;
      actor_id: string;
      target_id: string;
      target_type: string;
    }>(
      "select action, actor_id, target_id, target_type from public.audit_events where action = 'impersonation_started' order by created_at desc limit 1",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("impersonation_started");
    expect(audit.rows[0].actor_id).toBe(ADMIN);
    expect(audit.rows[0].target_id).toBe(USER_A);
    expect(audit.rows[0].target_type).toBe("user");
  });

  it("forbids admin from impersonating themselves", async () => {
    await as(ADMIN);

    await expect(
      db.query("select admin_start_impersonation($1)", [ADMIN]),
    ).rejects.toThrow(/cannot_impersonate_self/);
  });

  it("forbids non-admins from starting impersonation", async () => {
    await as(USER_B);

    await expect(
      db.query("select admin_start_impersonation($1)", [USER_A]),
    ).rejects.toThrow(/forbidden/);
  });

  it("allows platform admin to stop impersonation and writes an audit event", async () => {
    await as(ADMIN);

    const res = await db.query<{
      admin_stop_impersonation: { ok: boolean };
    }>("select admin_stop_impersonation($1)", [USER_A]);

    expect(res.rows[0].admin_stop_impersonation.ok).toBe(true);

    // Verify audit event
    await db.exec("reset role");
    const audit = await db.query<{
      action: string;
      actor_id: string;
      target_id: string;
    }>(
      "select action, actor_id, target_id from public.audit_events where action = 'impersonation_ended' order by created_at desc limit 1",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("impersonation_ended");
    expect(audit.rows[0].actor_id).toBe(ADMIN);
    expect(audit.rows[0].target_id).toBe(USER_A);
  });

  it("includes impersonation events in admin_audit reader", async () => {
    await as(ADMIN);

    const auditRes = await db.query<{
      admin_audit: {
        action: string;
        target_id: string;
        actor_email: string;
      };
    }>("select admin_audit(10)");

    const actions = auditRes.rows.map((r) => r.admin_audit.action);
    expect(actions).toContain("impersonation_started");
    expect(actions).toContain("impersonation_ended");
  });
});
