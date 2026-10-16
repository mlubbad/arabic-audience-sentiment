import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Owner console review batch C (2026-10-13, findings 8, 18 and 19): plan-wide
// changes leave an audit row, admin_audit refuses a null limit, and the
// owner's notes already stored in tenant-readable columns move to
// private.admin_notes when the migration runs.
const ADMIN = "10000000-0000-4000-8000-00000000000a";
const USER = "10000000-0000-4000-8000-00000000000b";
const MIGRATION = "20261030000000_admin_actions_leave_a_trail.sql";

const BOOT = `create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
  create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`;

const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

async function boot(until?: string) {
  const db = new PGlite();
  await db.exec(BOOT);
  for (const file of migrations) {
    if (until && file >= until) break;
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values ($1),($2)", [ADMIN, USER]);
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
  return db;
}

const homeOf = async (db: PGlite, user: string) =>
  (
    await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at limit 1",
      [user],
    )
  ).rows[0].id;

describe("admin actions leave a trail", () => {
  let db: PGlite;
  const as = async (user: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  };

  beforeAll(async () => {
    db = await boot();
  });
  afterAll(async () => {
    await db?.close();
  });

  const planRows = async () =>
    (
      await db.query<{ actor_id: string; target_id: string }>(
        "select actor_id, target_id from audit_events where action='plan_updated' and workspace_id is null and target_type='plan' order by created_at",
      )
    ).rows;

  it("records the public-channels toggle and the limits dialog, platform-wide", async () => {
    const before = (await planRows()).length;
    const { rows } = await db.query<{ key: string; allow: boolean }>(
      "select key, allow_public_channels as allow from plans where not internal order by key limit 1",
    );
    const plan = rows[0];
    await as(ADMIN);
    await db.query("select set_plan_public_channels($1,$2)", [
      plan.key,
      !plan.allow,
    ]);
    await db.query("select update_plan_limits($1,$2::jsonb)", [
      plan.key,
      JSON.stringify({ insight_reports: 7 }),
    ]);
    await db.exec("reset role");
    expect((await planRows()).slice(before)).toEqual([
      { actor_id: ADMIN, target_id: plan.key },
      { actor_id: ADMIN, target_id: plan.key },
    ]);
  });

  it("writes nothing for a save that changes nothing", async () => {
    const before = (await planRows()).length;
    const { rows } = await db.query<{ key: string; allow: boolean }>(
      "select key, allow_public_channels as allow from plans where not internal order by key limit 1",
    );
    await as(ADMIN);
    await db.query("select set_plan_public_channels($1,$2)", [
      rows[0].key,
      rows[0].allow,
    ]);
    await db.exec("reset role");
    expect((await planRows()).length).toBe(before);
  });

  it("refuses a null audit limit like any limit outside 1 to 500", async () => {
    await as(ADMIN);
    for (const limit of [null, 0, 501])
      await expect(
        db.query("select * from admin_audit($1)", [limit]),
      ).rejects.toThrow(/invalid_limit/);
    const ok = await db.query("select * from admin_audit(5)");
    expect(ok.rows.length).toBeGreaterThan(0);
    await db.exec("reset role");
  });

  it("names a deleted workspace's rows as such, not as the platform's", async () => {
    await db.exec("reset role");
    // Room for a second workspace.
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=$1",
      [await homeOf(db, USER)],
    );
    await as(USER);
    await db.query("select create_workspace('to go')");
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='to go'",
      )
    ).rows[0].id;
    await db.query(
      "insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1,$2,'impersonation_started','user',$3)",
      [w, USER, USER],
    );
    await as(ADMIN);
    await db.query("select delete_workspace($1)", [w]);
    const { rows } = await db.query<{
      admin_audit: {
        action: string;
        workspace_id: string | null;
        former_workspace_id: string | null;
        workspace_name: string;
      };
    }>("select * from admin_audit(500)");
    await db.exec("reset role");
    const kept = rows
      .map((r) => r.admin_audit)
      .find((e) => e.action === "impersonation_started");
    expect(kept).toMatchObject({
      workspace_id: null,
      former_workspace_id: w,
      workspace_name: "Deleted workspace",
    });
    // A workspace owner never reads a detached row: it names no workspace.
    await as(USER);
    const own = await db.query(
      "select 1 from audit_events where former_workspace_id=$1",
      [w],
    );
    expect(own.rows).toHaveLength(0);
    await db.exec("reset role");
  });

  it("keeps the owner's notes out of the tables a workspace's members read", async () => {
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        "select has_table_privilege($1, 'private.admin_notes', 'select') as ok",
        [role],
      );
      expect(rows[0].ok, role).toBe(false);
    }
  });
});

describe("the notes already stored move when the migration runs", () => {
  let db: PGlite;
  afterAll(async () => {
    await db?.close();
  });

  it("copies each note to admin_notes, clears the subscription, and re-keys the grant per workspace", async () => {
    db = await boot(MIGRATION);
    const w = await homeOf(db, USER);
    // As set_workspace_plan and grant_pack stored them before this change.
    await db.query(
      "update subscriptions set provider='admin', provider_ref='invoice 17' where workspace_id=$1",
      [w],
    );
    const grant = (
      await db.query<{ id: string }>(
        `insert into usage_grants(workspace_id,kind,units,expires_at,source,provider_ref)
         values ($1,'comment_analysis',100,now() + interval '30 days','admin','gift-1') returning id`,
        [w],
      )
    ).rows[0].id;
    await db.exec(readFileSync(`supabase/migrations/${MIGRATION}`, "utf8"));

    const notes = await db.query<{
      workspace_id: string;
      subject: string;
      ref: string;
      note: string;
    }>(
      "select workspace_id, subject, ref, note from private.admin_notes order by subject",
    );
    expect(notes.rows).toEqual([
      { workspace_id: w, subject: "pack", ref: grant, note: "gift-1" },
      {
        workspace_id: w,
        subject: "plan",
        ref: expect.any(String),
        note: "invoice 17",
      },
    ]);
    const sub = await db.query<{ provider_ref: string | null }>(
      "select provider_ref from subscriptions where workspace_id=$1",
      [w],
    );
    expect(sub.rows[0].provider_ref).toBeNull();
    const g = await db.query<{ provider_ref: string }>(
      "select provider_ref from usage_grants where id=$1",
      [grant],
    );
    expect(g.rows[0].provider_ref).not.toContain("gift-1");

    // A retry of that old grant, after the migration, still finds it.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ADMIN,
    ]);
    await db.exec("set role authenticated");
    const again = await db.query<{ grant_pack: string }>(
      "select grant_pack($1,'comment_analysis',100,'gift-1')",
      [w],
    );
    await db.exec("reset role");
    expect(again.rows[0].grant_pack).toBe(grant);
  });
});
