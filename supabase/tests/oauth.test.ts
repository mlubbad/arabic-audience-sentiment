import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const viewer = "10000000-0000-4000-8000-000000000003";
const CHANNEL = "UC" + "a".repeat(22);
// A stored state hash is a sha256 digest; these stand in at the same length.
const h = (name: string) => name.padEnd(64, "0");
// Stands in for an AES-GCM sealed token blob. The encryption itself happens in
// the Edge Function with a key from the service secret store; the database only
// ever sees opaque bytes.
const CIPHERTEXT = new Uint8Array([0x63, 0x69, 0x70, 0x68, 0x65, 0x72]);
let db: PGlite;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const admin = () => db.exec("reset role");
const attach = (state: string, channel = CHANNEL) =>
  db.query<{ id: string }>(
    "select private.oauth_attach_channel($1,$2,$3,$4,$5) as id",
    [state, channel, CIPHERTEXT, "k1", ["youtube.readonly"]],
  );

describe("youtube connection", () => {
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
      viewer,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner'),($1,$5,'viewer')",
      [A, ownerA, B, ownerB, viewer],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("only an owner may begin a connection, and only in their own workspace", async () => {
    await user(viewer);
    await expect(
      db.query("select public.oauth_start($1,$1,$2)", [A, h("h-viewer")]),
    ).rejects.toThrow();
    await user(ownerB);
    await expect(
      db.query("select public.oauth_start($1,$1,$2)", [A, h("h-b")]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select public.oauth_start($1,$1,$2)", [A, h("h-ok")]),
    ).resolves.toBeTruthy();
  });

  it("stores only a hash, and binds the state to who started it", async () => {
    await admin();
    const row = await db.query<{
      user_id: string;
      workspace_id: string;
      expires_at: string;
    }>(
      "select user_id, workspace_id, expires_at from private.oauth_states where state_hash=$1",
      [h("h-ok")],
    );
    expect(row.rows[0].user_id).toBe(ownerA);
    expect(row.rows[0].workspace_id).toBe(A);
    // Ten minutes, per the specification.
    const ttl = Date.parse(row.rows[0].expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000);
  });

  it("rejects a forged, an expired and a reused state", async () => {
    await admin();
    await expect(
      db.query("select private.oauth_consume_state($1)", ["never-issued"]),
    ).rejects.toThrow(/invalid_state/);

    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2)", [A, h("h-expired")]);
    await admin();
    await db.query(
      "update private.oauth_states set expires_at=now()-interval '1 second' where state_hash=$1",
      [h("h-expired")],
    );
    await expect(
      db.query("select private.oauth_consume_state($1)", [h("h-expired")]),
    ).rejects.toThrow(/invalid_state/);

    // Single use: the first consume succeeds, the second cannot.
    const first = await db.query<{ workspace_id: string }>(
      "select workspace_id from private.oauth_consume_state($1)",
      [h("h-ok")],
    );
    expect(first.rows[0].workspace_id).toBe(A);
    await expect(
      db.query("select private.oauth_consume_state($1)", [h("h-ok")]),
    ).rejects.toThrow(/invalid_state/);
  });

  it("takes the workspace from the stored state, never from the caller", async () => {
    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2)", [A, h("h-attach")]);
    await admin();
    // attach is given a state and a channel id only. There is no workspace
    // argument to forge, which is why the callback cannot be pointed at B.
    const created = await attach(h("h-attach"));
    expect(created.rows[0].id).toBeTruthy();
    const ch = await db.query<{ workspace_id: string; status: string }>(
      "select workspace_id, status from channels where id=$1",
      [created.rows[0].id],
    );
    expect(ch.rows[0]).toEqual({ workspace_id: A, status: "connected" });
  });

  it("upgrades a channel that was already being collected publicly", async () => {
    await admin();
    // The pilot case: public collection starts before the creator authorises.
    const pre = await db.query<{ id: string }>(
      "insert into channels(workspace_id,client_id,external_channel_id,status) values ($1,$1,$2,'public_unverified') returning id",
      [B, "UC" + "b".repeat(22)],
    );
    await user(ownerB);
    await db.query("select public.oauth_start($1,$1,$2)", [B, h("h-upgrade")]);
    await admin();
    const attached = await attach(h("h-upgrade"), "UC" + "b".repeat(22));
    // The same row is upgraded, not duplicated, so the collected data carries over.
    expect(attached.rows[0].id).toBe(pre.rows[0].id);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from channels where id=$1",
          [pre.rows[0].id],
        )
      ).rows[0].status,
    ).toBe("connected");
  });

  it("will not let a second workspace seize a connected channel", async () => {
    await admin();
    // B holds public data for the same channel A has verified. That is allowed:
    // public collection needs no authorisation.
    await db.query(
      "insert into channels(workspace_id,client_id,external_channel_id,status) values ($1,$1,$2,'public_unverified')",
      [B, CHANNEL],
    );
    await user(ownerB);
    await db.query("select public.oauth_start($1,$1,$2)", [B, h("h-seize")]);
    await admin();
    // But it can never become the authorised holder while A is connected.
    await expect(attach(h("h-seize"))).rejects.toThrow(
      /channel_already_connected/,
    );
    expect(
      (
        await db.query<{ status: string }>(
          "select status from channels where workspace_id=$1 and external_channel_id=$2",
          [B, CHANNEL],
        )
      ).rows[0].status,
    ).toBe("public_unverified");
  });

  it("keeps tokens out of every tenant-visible path", async () => {
    await user(ownerA);
    await expect(
      db.query("select * from private.oauth_connections"),
    ).rejects.toThrow();
    await expect(
      db.query("select * from private.oauth_states"),
    ).rejects.toThrow();
    // The status view a tenant may read carries no secret column at all.
    const visible = await db.query<{ status: string }>(
      "select status from public.connection_status where workspace_id=$1",
      [A],
    );
    expect(visible.rows[0].status).toBe("connected");
    await expect(
      db.query("select encrypted_tokens from public.connection_status"),
    ).rejects.toThrow();
  });

  it("stops dependent work when a connection is revoked or disconnected", async () => {
    await admin();
    const ch = await db.query<{ id: string }>(
      "select id from channels where workspace_id=$1 and external_channel_id=$2",
      [A, CHANNEL],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$2,'collect','j-queued','queued')",
      [A, ch.rows[0].id],
    );
    // A revoked token must not silently fall back to scraping.
    await db.query("select private.oauth_mark_revoked($1)", [ch.rows[0].id]);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from channels where id=$1",
          [ch.rows[0].id],
        )
      ).rows[0].status,
    ).toBe("reconnect_required");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from jobs where dedupe_key='j-queued'",
        )
      ).rows[0].status,
    ).toBe("cancelled");

    await user(ownerA);
    await db.query("select public.oauth_disconnect($1,$2)", [A, ch.rows[0].id]);
    await admin();
    expect(
      (
        await db.query<{ status: string }>(
          "select status from channels where id=$1",
          [ch.rows[0].id],
        )
      ).rows[0].status,
    ).toBe("disconnected");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from private.oauth_connections where channel_id=$1",
          [ch.rows[0].id],
        )
      ).rows[0].status,
    ).toBe("revoked");
  });

  it("lets only an owner disconnect", async () => {
    await user(viewer);
    await expect(
      db.query("select public.oauth_disconnect($1,$1)", [A]),
    ).rejects.toThrow();
  });
});
