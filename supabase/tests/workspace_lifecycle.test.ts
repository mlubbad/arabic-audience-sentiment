/**
 * Renaming a workspace, and handing one over.
 *
 * "Delete" in the account page is not a deletion: the owner asked that nothing
 * collected is ever dropped. Retiring a workspace removes its members, revokes
 * the Google grant that belonged to the leaving owner, cancels pending work,
 * and moves the workspace under the platform owner's own root — the rows stay
 * where they are, with a record of whose they were.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ADMIN = "10000000-0000-4000-8000-00000000000a";
const OTHER = "10000000-0000-4000-8000-00000000000b";
let db: PGlite;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const home = async (user: string) =>
  (
    await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at limit 1",
      [user],
    )
  ).rows[0].id;

describe("workspace lifecycle", () => {
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
    await db.exec("reset role");
    for (const u of [ADMIN, OWNER, OTHER])
      await db.query("insert into auth.users(id) values ($1)", [u]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [await home(ADMIN)],
    );
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=$1",
      [await home(OWNER)],
    );
  });

  it("the owner renames a workspace; a member who is not the owner cannot", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await db.query("select rename_workspace($1,'  قناة الأخبار  ')", [w]);
    await db.exec("reset role");
    const r = await db.query<{ name: string }>(
      "select name from workspaces where id=$1",
      [w],
    );
    expect(r.rows[0].name).toBe("قناة الأخبار");
    await db.query("insert into memberships values ($1,$2,'analyst')", [
      w,
      OTHER,
    ]);
    await as(OTHER);
    await expect(
      db.query("select rename_workspace($1,'x')", [w]),
    ).rejects.toThrow(/forbidden/);
    await as(OWNER);
    await expect(
      db.query("select rename_workspace($1,'   ')", [w]),
    ).rejects.toThrow(/invalid_name/);
    await db.exec("reset role");
    const a = await db.query<{ action: string; target_id: string }>(
      "select action,target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [w],
    );
    expect(a.rows[0]).toEqual({
      action: "workspace_renamed",
      target_id: "قناة الأخبار",
    });
  });

  it("retiring a workspace keeps every row, removes the members, and hands it to the platform owner", async () => {
    await as(OWNER);
    await db.query("select create_workspace('client one')");
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='client one'",
      )
    ).rows[0].id;
    await db.query("insert into memberships values ($1,$2,'viewer')", [
      w,
      OTHER,
    ]);
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,(select id from clients where workspace_id=$1),'UC${"c".repeat(22)}','connected')`,
      [w],
    );
    await db.query(
      `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
       values ($1,$1,$2,'\\x00','v1','{}','active')`,
      [w, OWNER],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'aaaaaaaaaaa','v')`,
      [w],
    );
    await db.query(
      `insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$1,'collect','k','queued')`,
      [w],
    );

    await as(OTHER);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /forbidden/,
    );
    await as(OWNER);
    await db.query("select retire_workspace($1)", [w]);
    await db.exec("reset role");

    const adminHome = await home(ADMIN);
    const m = await db.query<{ user_id: string; role: string }>(
      "select user_id,role from memberships where workspace_id=$1",
      [w],
    );
    expect(m.rows).toEqual([{ user_id: ADMIN, role: "workspace_owner" }]);
    const ws = await db.query<{
      created_by: string;
      retired_from: string;
      retired_at: string | null;
    }>(
      "select created_by,retired_from,retired_at from workspaces where id=$1",
      [w],
    );
    expect(ws.rows[0].created_by).toBe(ADMIN);
    expect(ws.rows[0].retired_from).toBe(OWNER);
    expect(ws.rows[0].retired_at).not.toBeNull();
    const s = await db.query<{
      plan_key: string;
      billing_workspace_id: string;
    }>(
      "select plan_key,billing_workspace_id from subscriptions where workspace_id=$1",
      [w],
    );
    expect(s.rows[0]).toEqual({
      plan_key: "owner",
      billing_workspace_id: adminHome,
    });
    const ch = await db.query<{ status: string }>(
      "select status from channels where workspace_id=$1",
      [w],
    );
    expect(ch.rows[0].status).toBe("disconnected");
    const g = await db.query<{ status: string }>(
      "select status from private.oauth_connections where workspace_id=$1",
      [w],
    );
    expect(g.rows[0].status).toBe("revoked");
    const j = await db.query<{ status: string; error_code: string }>(
      "select status,error_code from jobs where workspace_id=$1",
      [w],
    );
    expect(j.rows[0]).toEqual({
      status: "cancelled",
      error_code: "disconnected",
    });
    // Nothing collected is gone.
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from videos where workspace_id=$1",
          [w],
        )
      ).rows[0].n,
    ).toBe(1);
    const a = await db.query<{ action: string }>(
      "select action from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [w],
    );
    expect(a.rows[0].action).toBe("workspace_retired");
    // The former owner no longer sees it.
    await as(OWNER);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from workspaces where id=$1",
          [w],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("the last workspace a user owns cannot be retired", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /last_workspace/,
    );
  });
});
