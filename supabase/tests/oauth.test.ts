import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// RFC 7636 appendix B: 43 unreserved characters.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
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
      db.query("select public.oauth_start($1,$1,$2,$3)", [
        A,
        h("h-viewer"),
        VERIFIER,
      ]),
    ).rejects.toThrow();
    await user(ownerB);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3)", [
        A,
        h("h-b"),
        VERIFIER,
      ]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3)", [
        A,
        h("h-ok"),
        VERIFIER,
      ]),
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
    await db.query("select public.oauth_start($1,$1,$2,$3)", [
      A,
      h("h-expired"),
      VERIFIER,
    ]);
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
    await db.query("select public.oauth_start($1,$1,$2,$3)", [
      A,
      h("h-attach"),
      VERIFIER,
    ]);
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
    await db.query("select public.oauth_start($1,$1,$2,$3)", [
      B,
      h("h-upgrade"),
      VERIFIER,
    ]);
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
    await db.query("select public.oauth_start($1,$1,$2,$3)", [
      B,
      h("h-seize"),
      VERIFIER,
    ]);
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

  it("prunes spent states without touching a connection in flight", async () => {
    // The table is single-use and was never cleaned, so every attempt ever
    // made stayed on disk: who started linking which client, and when.
    await db.exec("reset role");
    await db.exec("delete from private.oauth_states");
    await db.query(
      `insert into private.oauth_states(state_hash,user_id,workspace_id,client_id,expires_at,consumed_at) values
        ('old-consumed',$1,$2,$2,now()-interval '30 days',now()-interval '30 days'),
        ('old-expired',$1,$2,$2,now()-interval '30 days',null),
        ('recent-consumed',$1,$2,$2,now()-interval '1 hour',now()-interval '1 hour'),
        ('in-flight',$1,$2,$2,now()+interval '5 minutes',null)`,
      [ownerA, A],
    );
    const removed = await db.query<{ prune_oauth_states: number }>(
      "select private.prune_oauth_states()",
    );
    expect(removed.rows[0].prune_oauth_states).toBe(2);
    const left = await db.query<{ state_hash: string }>(
      "select state_hash from private.oauth_states order by state_hash",
    );
    // The in-flight state survives, and so does anything inside the window.
    expect(left.rows.map((r) => r.state_hash)).toEqual([
      "in-flight",
      "recent-consumed",
    ]);
  });

  it("still refuses a replay once the state it consumed has been pruned", async () => {
    // Deleting a consumed state must not reopen it. Consume requires the row
    // to exist, be unconsumed and be unexpired, so an absent row and a
    // consumed row refuse identically.
    await db.exec("reset role");
    await db.exec("delete from private.oauth_states");
    await db.query(
      `insert into private.oauth_states(state_hash,user_id,workspace_id,client_id,expires_at,consumed_at)
       values ('spent',$1,$2,$2,now()-interval '30 days',now()-interval '30 days')`,
      [ownerA, A],
    );
    await db.query("select private.prune_oauth_states()");
    await expect(
      db.query("select * from private.oauth_consume_state('spent')"),
    ).rejects.toThrow(/invalid_state/);
  });

  it("is service-only: a tenant cannot prune the state table", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerA,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select private.prune_oauth_states()"),
    ).rejects.toThrow();
    await db.exec("reset role");
  });

  it("refuses a verifier that is too short or outside the unreserved set", async () => {
    // RFC 7636 4.1. Checked at start because the exchange cannot check it
    // later: by then a weak verifier has already been used.
    await user(ownerA);
    for (const bad of [
      "short",
      "a".repeat(42),
      "a".repeat(129),
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)}/`,
      `${"a".repeat(42)} `,
    ]) {
      await expect(
        db.query("select public.oauth_start($1,$1,$2,$3)", [
          A,
          h(`h-bad-${bad.length}${bad.slice(-1)}`),
          bad,
        ]),
      ).rejects.toThrow(/invalid_verifier/);
    }
    // The boundary lengths themselves are valid.
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3)", [
        A,
        h("h-min"),
        "a".repeat(43),
      ]),
    ).resolves.toBeTruthy();
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3)", [
        A,
        h("h-max"),
        `${"a".repeat(124)}._~-`,
      ]),
    ).resolves.toBeTruthy();
  });

  it("hands the verifier to the exchange once, and never to a tenant", async () => {
    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2,$3)", [
      A,
      h("h-pkce"),
      VERIFIER,
    ]);
    // A tenant cannot read it back: the state table has no grants at all, and
    // consume is service-only.
    await expect(
      db.query(
        "select code_verifier from private.oauth_states where state_hash=$1",
        [h("h-pkce")],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("select private.oauth_consume_state($1)", [h("h-pkce")]),
    ).rejects.toThrow();

    await admin();
    const consumed = await db.query<{ code_verifier: string }>(
      "select code_verifier from private.oauth_consume_state($1)",
      [h("h-pkce")],
    );
    expect(consumed.rows[0].code_verifier).toBe(VERIFIER);
    // Single use still holds, so a stolen code cannot be exchanged twice.
    await expect(
      db.query("select private.oauth_consume_state($1)", [h("h-pkce")]),
    ).rejects.toThrow(/invalid_state/);
  });

  it("publishes exactly the entry points the functions need, to service_role only", async () => {
    // PostgREST exposes public only, so the Edge Functions had no route to any
    // private primitive. These wrappers open six of them and nothing else — the
    // alternative, putting `private` on the API, would publish every internal
    // function to anyone holding any key.
    await user(ownerA);
    for (const call of [
      "select * from public.svc_oauth_consume_state('x')",
      "select public.svc_worker_claim('x')",
      "select public.svc_worker_heartbeat('x',$1,$1)",
      "select public.svc_worker_finish('x',$1,$1,'succeeded',null)",
    ])
      await expect(
        db.query(call, call.includes("$1") ? [A] : []),
      ).rejects.toThrow(/permission denied|forbidden/);
    await admin();
  });

  it("keeps the workspace out of every service entry point", async () => {
    // The tenant comes from the worker's hashed credential or from the consumed
    // state. If one of these took a workspace, the whole derivation would be
    // decorative — so the signatures are asserted, not trusted.
    await admin();
    const args = await db.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'svc_worker%'
       order by p.proname`,
    );
    expect(args.rows.length).toBeGreaterThan(0);
    for (const row of args.rows) expect(row.args).not.toContain("workspace");
  });
});
