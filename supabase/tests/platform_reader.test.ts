/**
 * The platform reader: one OAuth grant the platform reads public channels
 * with. Promotion is the admin's copy of a live connected grant; the worker
 * seam hands the seal to any valid credential and writes renewals back to
 * the reader's own row, never to the channel the grant was copied from.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const adminUser = "10000000-0000-4000-8000-000000000009";
const CRED = "aa".repeat(32); // sha256 hex of some secret, straight into the table
const CHANNEL_ID = "UCTPIL6f7yNpK8yc-H3cEtFg";
let db: PGlite;

async function user(id: string | null) {
  await db.exec("reset role");
  if (id)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const admin = () => db.exec("reset role");

describe("the platform reader", () => {
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
    await db.query("insert into auth.users(id) values ($1),($2)", [
      ownerA,
      adminUser,
    ]);
    await admin();
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      adminUser,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$2)",
      [A, ownerA],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      A,
      ownerA,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A')",
      [A],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,$1,$2,'connected')`,
      [A, CHANNEL_ID],
    );
    // A live, connected grant whose seal the promotion copies.
    await db.query(
      `insert into private.oauth_connections(workspace_id,channel_id,connected_by,
         encrypted_tokens,key_version,granted_scopes,status)
       values ($1,$1,$2,'\\x6162','k1','{scope}','connected')`,
      [A, ownerA],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'platform',null)",
      [CRED],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("promotion is the platform admin's alone", async () => {
    await user(ownerA);
    await expect(
      db.query("select promote_platform_reader($1,$2)", [A, A]),
    ).rejects.toThrow(/forbidden|permission denied/i);
  });

  it("copies the live seal into one active row", async () => {
    await user(adminUser);
    await db.query("select promote_platform_reader($1,$2)", [A, A]);
    await admin();
    const { rows } = await db.query<{
      n: number;
      status: string;
      tokens: string;
    }>(
      "select count(*)::int as n, status, encode(encrypted_tokens,'hex') as tokens from private.platform_reader group by status, tokens",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].tokens).toBe("6162"); // the copied seal, byte for byte
    // Recorded platform-wide (review finding 8), with no workspace, so the
    // channel's owner does not read the platform's choice.
    const trail = await db.query<{
      workspace_id: string | null;
      actor_id: string;
      target_id: string;
    }>(
      "select workspace_id, actor_id, target_id from audit_events where action='platform_reader_promoted'",
    );
    expect(trail.rows).toEqual([
      { workspace_id: null, actor_id: adminUser, target_id: A },
    ]);
  });

  it("is executable by signed-in callers only, never PUBLIC or anon", async () => {
    await admin();
    const { rows } = await db.query<{
      anon: boolean;
      authed: boolean;
      pub: boolean;
    }>(
      `select has_function_privilege('anon', 'public.promote_platform_reader(uuid,uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.promote_platform_reader(uuid,uuid)', 'execute') as authed,
              exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = 'public.promote_platform_reader(uuid,uuid)'::regprocedure
                         and a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub`,
    );
    expect(rows[0]).toEqual({ anon: false, authed: true, pub: false });
  });

  it("re-promotion retires the old row and keeps exactly one active", async () => {
    await admin();
    await db.query(
      "update private.oauth_connections set encrypted_tokens='\\x6364' where workspace_id=$1",
      [A],
    );
    await user(adminUser);
    await db.query("select promote_platform_reader($1,$2)", [A, A]);
    await admin();
    const { rows } = await db.query<{ status: string; tokens: string }>(
      "select status, encode(encrypted_tokens,'hex') as tokens from private.platform_reader order by created_at",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("retired");
    expect(rows[1].status).toBe("active");
    expect(rows[1].tokens).toBe("6364");
  });

  it("refuses a channel nobody has connected", async () => {
    await admin();
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id)
       values ($1,$2,$2,'UCzzzzzzzzzzzzzzzzzzzzzz')`,
      ["00000000-0000-4000-8000-00000000000f", A],
    );
    await user(adminUser);
    await expect(
      db.query("select promote_platform_reader($1,$2)", [
        A,
        "00000000-0000-4000-8000-00000000000f",
      ]),
    ).rejects.toThrow(/channel_not_connected/);
  });

  it("hands the seal to any valid worker credential, and to no invalid one", async () => {
    await admin();
    const { rows } = await db.query<{ encrypted_tokens: string }>(
      "select encode(encrypted_tokens,'hex') as encrypted_tokens from svc_worker_reader_grant($1)",
      [CRED],
    );
    expect(rows[0].encrypted_tokens).toBe("6364");
    await expect(
      db.query("select * from svc_worker_reader_grant($1)", ["ff".repeat(32)]),
    ).rejects.toThrow(/invalid_worker_credential/);
  });

  it("writes renewals back to the reader row, and revocation retires it", async () => {
    await admin();
    const { rows } = await db.query<{ connection_id: string }>(
      "select connection_id from svc_worker_reader_grant($1)",
      [CRED],
    );
    await db.query("select svc_worker_store_reader_grant($1,$2,'\\x6566')", [
      CRED,
      rows[0].connection_id,
    ]);
    const stored = await db.query<{ tokens: string }>(
      "select encode(encrypted_tokens,'hex') as tokens from private.platform_reader where id=$1",
      [rows[0].connection_id],
    );
    expect(stored.rows[0].tokens).toBe("6566");
    // The channel connection the seal came from is never touched by renewals.
    const original = await db.query<{ tokens: string }>(
      "select encode(encrypted_tokens,'hex') as tokens from private.oauth_connections where workspace_id=$1",
      [A],
    );
    expect(original.rows[0].tokens).toBe("6364");

    await db.query("select svc_worker_reader_revoked($1,$2)", [
      CRED,
      rows[0].connection_id,
    ]);
    const after = await db.query<{ status: string }>(
      "select status from private.platform_reader where id=$1",
      [rows[0].connection_id],
    );
    expect(after.rows[0].status).toBe("retired");
  });

  it("the lookup door is service-role only", async () => {
    // The reader was retired by the revocation test; a fresh promotion first.
    await admin();
    await db.query(
      "update private.platform_reader set status='active', retired_at=null where id = (select id from private.platform_reader order by created_at desc limit 1)",
    );
    await user(ownerA);
    await expect(
      db.query("select connection_id from channel_lookup_reader_grant()"),
    ).rejects.toThrow(/permission denied|not permitted/i);
    await db.exec("reset role");
    await db.exec("set role service_role");
    const { rows } = await db.query(
      "select connection_id from channel_lookup_reader_grant()",
    );
    expect(rows.length).toBe(1);
  });
});
