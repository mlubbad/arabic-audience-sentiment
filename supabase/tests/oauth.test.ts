import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
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
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
// Stands in for an AES-GCM sealed token blob. The encryption itself happens in
// the Edge Function with a key from the service secret store; the database only
// ever sees opaque bytes.
const NONCE_HASH = "a".repeat(64);
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

const createPending = async (
  who: string,
  workspace: string,
  state: string,
  ticket: string,
  nonce: string,
  channel: string,
) => {
  await user(who);
  await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
    workspace,
    h(state),
    VERIFIER,
    sha(nonce),
  ]);
  await admin();
  const consumed = await db.query<{ state_id: string }>(
    "select state_id from private.oauth_consume_state($1)",
    [h(state)],
  );
  await db.query(
    "select private.oauth_create_pending($1,$2,$3,$4,'k1',$5,null,null)",
    [
      consumed.rows[0].state_id,
      sha(ticket),
      channel,
      CIPHERTEXT,
      ["youtube.force-ssl"],
    ],
  );
};

describe("youtube connection", () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema extensions; create extension pgcrypto with schema extensions;
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
    // A workspace with no subscription row has no plan, and since
    // 20260917060000 plan_limit refuses it rather than answering "no ceiling";
    // these two are about the connection, not the ladder, so they get the
    // plan without one.
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'owner','active',now(),now()+interval '100 years'),($2,'owner','active',now(),now()+interval '100 years')`,
      [A, B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("only an owner may begin a connection, and only in their own workspace", async () => {
    await user(viewer);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        A,
        h("h-viewer"),
        VERIFIER,
        NONCE_HASH,
      ]),
    ).rejects.toThrow();
    await user(ownerB);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        A,
        h("h-b"),
        VERIFIER,
        NONCE_HASH,
      ]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        A,
        h("h-ok"),
        VERIFIER,
        NONCE_HASH,
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
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      A,
      h("h-expired"),
      VERIFIER,
      NONCE_HASH,
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
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      A,
      h("h-attach"),
      VERIFIER,
      NONCE_HASH,
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
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      B,
      h("h-upgrade"),
      VERIFIER,
      NONCE_HASH,
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
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      B,
      h("h-seize"),
      VERIFIER,
      NONCE_HASH,
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

  it("stores the channel's names when Google sends them, and keeps them when it does not", async () => {
    await admin();
    const named = "UC" + "n".repeat(22);
    await user(ownerB);
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      B,
      h("h-named"),
      VERIFIER,
      NONCE_HASH,
    ]);
    await admin();
    // The service entry point, as the Edge Function calls it: by name, with
    // the two names beside the id.
    const st = await db.query<{ user_id: string; client_id: string }>(
      "select user_id, client_id from private.oauth_consume_state($1)",
      [h("h-named")],
    );
    const ch = await db.query<{ id: string }>(
      `select public.svc_oauth_attach_channel(
         u => $1, w => $2, c => $3, external_channel => $4, tokens => $5,
         key_version => 'k1', scopes => $6,
         channel_handle => '@named', channel_title => 'قناة مسمّاة') as id`,
      [
        st.rows[0].user_id,
        B,
        st.rows[0].client_id,
        named,
        CIPHERTEXT,
        ["youtube.readonly"],
      ],
    );
    // A tenant reads them from the same view that carries the status.
    await user(ownerB);
    const seen = await db.query<{ handle: string; title: string }>(
      "select handle, title from connection_status where channel_id=$1",
      [ch.rows[0].id],
    );
    expect(seen.rows[0]).toEqual({ handle: "@named", title: "قناة مسمّاة" });

    // A reconnect that carries no names — an older deploy of the callback, or
    // a snippet Google left out — must not erase the ones already stored.
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      B,
      h("h-named-again"),
      VERIFIER,
      NONCE_HASH,
    ]);
    await admin();
    await attach(h("h-named-again"), named);
    const kept = await db.query<{ handle: string; title: string }>(
      "select handle, title from channels where id=$1",
      [ch.rows[0].id],
    );
    expect(kept.rows[0]).toEqual({ handle: "@named", title: "قناة مسمّاة" });
  });

  it("retires the previous grant when a channel is re-linked, and holds one live grant per channel", async () => {
    await admin();
    const twice = "UC" + "t".repeat(22);
    const link = async (name: string) => {
      await user(ownerB);
      await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        B,
        h(name),
        VERIFIER,
        NONCE_HASH,
      ]);
      await admin();
      return (await attach(h(name), twice)).rows[0].id;
    };
    const first = await link("h-twice-1");
    expect(await link("h-twice-2")).toBe(first);
    // Two rows, one of them live. The worker's reader picks among connected
    // rows by `id desc`, and ids are random: with two connected rows the grant
    // it collected with was a coin toss. Now there is one to choose from.
    const rows = await db.query<{ status: string; n: number }>(
      "select status, count(*)::int as n from private.oauth_connections where channel_id=$1 group by status order by status",
      [first],
    );
    expect(rows.rows).toEqual([
      { status: "connected", n: 1 },
      { status: "superseded", n: 1 },
    ]);
    // And the table refuses a second live grant outright, so a writer that
    // forgets to retire the old one is stopped rather than quietly restoring
    // the coin toss.
    await expect(
      db.query(
        `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
         values ($1,$2,$3,$4,'k1',$5,'connected')`,
        [B, first, ownerB, CIPHERTEXT, ["youtube.readonly"]],
      ),
    ).rejects.toThrow(/oauth_connections_one_connected/);
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
        db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
          A,
          h(`h-bad-${bad.length}${bad.slice(-1)}`),
          bad,
          NONCE_HASH,
        ]),
      ).rejects.toThrow(/invalid_verifier/);
    }
    // The boundary lengths themselves are valid.
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        A,
        h("h-min"),
        "a".repeat(43),
        NONCE_HASH,
      ]),
    ).resolves.toBeTruthy();
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
        A,
        h("h-max"),
        `${"a".repeat(124)}._~-`,
        NONCE_HASH,
      ]),
    ).resolves.toBeTruthy();
  });

  it("hands the verifier to the exchange once, and never to a tenant", async () => {
    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      A,
      h("h-pkce"),
      VERIFIER,
      NONCE_HASH,
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

  it("gives every workspace a client, so connecting is reachable at all", async () => {
    // oauth_start and register_channel both require a client that belongs to
    // the workspace, and nothing used to create one. A user could sign up, get
    // a workspace, and reach a wall with no way past it.
    await admin();
    await db.query("insert into auth.users(id) values ($1)", [
      "10000000-0000-4000-8000-0000000000ff",
    ]);
    const w = await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1",
      ["10000000-0000-4000-8000-0000000000ff"],
    );
    // The trigger made a personal workspace; it must also have made a client.
    expect(w.rows).toHaveLength(1);
    const clients = await db.query<{ n: number }>(
      "select count(*)::int as n from clients where workspace_id=$1",
      [w.rows[0].id],
    );
    expect(clients.rows[0].n).toBe(1);
  });

  it("lets a fresh account actually begin a connection", async () => {
    // The end-to-end shape of the fix: sign up, take the workspace and the
    // client the account was given, and oauth_start accepts them.
    await admin();
    const owner = "10000000-0000-4000-8000-0000000000fe";
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    const row = await db.query<{ w: string; c: string }>(
      `select w.id as w, c.id as c from workspaces w
       join clients c on c.workspace_id = w.id where w.created_by = $1`,
      [owner],
    );
    await user(owner);
    await expect(
      db.query("select public.oauth_start($1,$2,$3,$4,$5)", [
        row.rows[0].w,
        row.rows[0].c,
        h("h-journey"),
        VERIFIER,
        NONCE_HASH,
      ]),
    ).resolves.toBeTruthy();
    await admin();
  });

  it("the backfill statement gives a clientless workspace a client", async () => {
    // This covers the statement's logic, and deliberately not its presence in
    // the migration: the suite runs every migration against a fresh database
    // before inserting anything, so it cannot construct a workspace older than
    // the rule. Removing the backfill from the migration does not fail this.
    //
    // That the backfill actually ran is verified against the live project
    // instead, where the three workspaces created before it now each have a
    // client. See docs/verification.md.
    await admin();
    const w = await db.query<{ id: string }>(
      "insert into workspaces(name,created_by) values ('قديمة',$1) returning id",
      [ownerA],
    );
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from clients where workspace_id=$1",
          [w.rows[0].id],
        )
      ).rows[0].n,
    ).toBe(0);

    await db.exec(`insert into public.clients(workspace_id,name)
      select w.id, w.name from public.workspaces w
      where not exists (select 1 from public.clients c where c.workspace_id = w.id)`);

    expect(
      (
        await db.query<{ name: string }>(
          "select name from clients where workspace_id=$1",
          [w.rows[0].id],
        )
      ).rows[0].name,
    ).toBe("قديمة");
  });

  it("refuses completion by a different user and deletes the ticket", async () => {
    const channel = `UC${"c".repeat(22)}`;
    await createPending(
      ownerA,
      A,
      "binding-user",
      "ticket-user",
      "nonce-user",
      channel,
    );
    await user(ownerB);
    const refused = await db.query<{ channel_id: string | null; code: string }>(
      "select * from public.oauth_complete($1,$2)",
      ["ticket-user", "nonce-user"],
    );
    expect(refused.rows[0]).toEqual({
      channel_id: null,
      code: "oauth_binding_mismatch",
    });
    await admin();
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from channels where external_channel_id=$1",
          [channel],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from private.oauth_pending",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("refuses a wrong or missing browser nonce and consumes each ticket", async () => {
    for (const [suffix, supplied] of [
      ["wrong", "another-nonce"],
      ["missing", null],
    ] as const) {
      const ticket = `ticket-${suffix}`;
      await createPending(
        ownerA,
        A,
        `binding-${suffix}`,
        ticket,
        `nonce-${suffix}`,
        `UC${suffix[0].repeat(22)}`,
      );
      await user(ownerA);
      const refused = await db.query<{ code: string }>(
        "select * from public.oauth_complete($1,$2)",
        [ticket, supplied],
      );
      expect(refused.rows[0].code).toBe("oauth_binding_mismatch");
      const replay = await db.query<{ code: string }>(
        "select * from public.oauth_complete($1,$2)",
        [ticket, `nonce-${suffix}`],
      );
      expect(replay.rows[0].code).toBe("oauth_binding_mismatch");
    }
  });

  it("refuses expired tickets", async () => {
    await createPending(
      ownerA,
      A,
      "binding-expired-ticket",
      "expired-ticket",
      "expired-nonce",
      `UC${"e".repeat(22)}`,
    );
    await admin();
    await db.exec(
      "update private.oauth_pending set expires_at=now()-interval '1 second'",
    );
    await user(ownerA);
    const result = await db.query<{ code: string }>(
      "select * from public.oauth_complete($1,$2)",
      ["expired-ticket", "expired-nonce"],
    );
    expect(result.rows[0].code).toBe("oauth_binding_mismatch");
  });

  it("attaches exactly once and refuses a replayed ticket", async () => {
    const channel = `UC${"f".repeat(22)}`;
    await createPending(
      ownerA,
      A,
      "binding-happy",
      "happy-ticket",
      "happy-nonce",
      channel,
    );
    await user(ownerA);
    const first = await db.query<{ channel_id: string; code: string | null }>(
      "select * from public.oauth_complete($1,$2)",
      ["happy-ticket", "happy-nonce"],
    );
    expect(first.rows[0].channel_id).toBeTruthy();
    expect(first.rows[0].code).toBeNull();
    const replay = await db.query<{ channel_id: string | null; code: string }>(
      "select * from public.oauth_complete($1,$2)",
      ["happy-ticket", "happy-nonce"],
    );
    expect(replay.rows[0].code).toBe("oauth_binding_mismatch");
    await admin();
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from private.oauth_connections where channel_id=$1 and status='connected'",
          [first.rows[0].channel_id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("keeps pending grants invisible to tenant roles", async () => {
    await createPending(
      ownerA,
      A,
      "binding-private",
      "private-ticket",
      "private-nonce",
      `UC${"g".repeat(22)}`,
    );
    await user(ownerA);
    await expect(
      db.query("select * from private.oauth_pending"),
    ).rejects.toThrow();
  });

  // ----- Meta providers (Facebook pages, Instagram accounts) -----------------

  const PAGE = "123456789012345";
  const createMetaPending = async (
    who: string,
    workspace: string,
    provider: "facebook" | "instagram",
    state: string,
    ticket: string,
    nonce: string,
    external: string,
  ) => {
    await user(who);
    await db.query("select public.oauth_start($1,$1,$2,$3,$4,$5)", [
      workspace,
      h(state),
      VERIFIER,
      sha(nonce),
      provider,
    ]);
    await admin();
    const consumed = await db.query<{ state_id: string; provider: string }>(
      "select state_id, provider from private.oauth_consume_state($1)",
      [h(state)],
    );
    expect(consumed.rows[0].provider).toBe(provider);
    await db.query(
      "select private.oauth_create_pending($1,$2,$3,$4,'k1',$5,null,null,$6)",
      [
        consumed.rows[0].state_id,
        sha(ticket),
        external,
        CIPHERTEXT,
        ["pages_read_engagement"],
        provider,
      ],
    );
  };

  it("stores the provider on the state and hands it back to the service", async () => {
    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2,$3,$4,$5)", [
      A,
      h("h-provider"),
      VERIFIER,
      NONCE_HASH,
      "facebook",
    ]);
    // The five-argument call still works and means Google, as every existing caller expects.
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      A,
      h("h-google"),
      VERIFIER,
      NONCE_HASH,
    ]);
    await admin();
    await db.exec("set role service_role");
    const fb = await db.query<{ provider: string }>(
      "select provider from public.svc_oauth_consume_state($1)",
      [h("h-provider")],
    );
    const google = await db.query<{ provider: string }>(
      "select provider from public.svc_oauth_consume_state($1)",
      [h("h-google")],
    );
    await admin();
    expect(fb.rows[0].provider).toBe("facebook");
    expect(google.rows[0].provider).toBe("google");
  });

  it("refuses an unknown provider", async () => {
    await user(ownerA);
    await expect(
      db.query("select public.oauth_start($1,$1,$2,$3,$4,$5)", [
        A,
        h("h-bad"),
        VERIFIER,
        NONCE_HASH,
        "myspace",
      ]),
    ).rejects.toThrow(/invalid_provider/);
    await admin();
  });

  it("a Meta pending row refuses a UC id and accepts a numeric page id", async () => {
    await expect(
      createMetaPending(ownerA, A, "facebook", "m-uc", "t-uc", "n-uc", CHANNEL),
    ).rejects.toThrow(/invalid_channel_id/);
    await admin();
    await createMetaPending(
      ownerA,
      A,
      "facebook",
      "m-num",
      "t-num",
      "n-num",
      PAGE,
    );
    // And a YouTube pending row still refuses a numeric id.
    await user(ownerA);
    await db.query("select public.oauth_start($1,$1,$2,$3,$4)", [
      A,
      h("m-yt"),
      VERIFIER,
      NONCE_HASH,
    ]);
    await admin();
    const consumed = await db.query<{ state_id: string }>(
      "select state_id from private.oauth_consume_state($1)",
      [h("m-yt")],
    );
    await expect(
      db.query(
        "select private.oauth_create_pending($1,$2,$3,$4,'k1',$5,null,null)",
        [consumed.rows[0].state_id, sha("t-yt-num"), PAGE, CIPHERTEXT, ["x"]],
      ),
    ).rejects.toThrow(/invalid_channel_id/);
  });

  it("attaches a Facebook page under its own platform and keeps platforms apart", async () => {
    await createMetaPending(
      ownerA,
      A,
      "facebook",
      "m-fb",
      "t-fb",
      "n-fb",
      PAGE,
    );
    await user(ownerA);
    const done = await db.query<{
      channel_id: string | null;
      code: string | null;
    }>("select * from public.oauth_complete($1,$2)", ["t-fb", "n-fb"]);
    expect(done.rows[0].code).toBeNull();
    await admin();
    const row = await db.query<{
      platform: string;
      status: string;
      external_channel_id: string;
    }>(
      "select platform, status, external_channel_id from channels where id=$1",
      [done.rows[0].channel_id],
    );
    expect(row.rows[0]).toEqual({
      platform: "facebook",
      status: "connected",
      external_channel_id: PAGE,
    });

    // The same numeric id on Instagram is a different channel, not an upgrade of the page.
    await createMetaPending(
      ownerA,
      A,
      "instagram",
      "m-ig",
      "t-ig",
      "n-ig",
      PAGE,
    );
    await user(ownerA);
    const ig = await db.query<{
      channel_id: string | null;
      code: string | null;
    }>("select * from public.oauth_complete($1,$2)", ["t-ig", "n-ig"]);
    expect(ig.rows[0].code).toBeNull();
    expect(ig.rows[0].channel_id).not.toBe(done.rows[0].channel_id);
    await admin();
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from channels where workspace_id=$1 and external_channel_id=$2 and status='connected'",
      [A, PAGE],
    );
    expect(n.rows[0].n).toBe(2);
    const grants = await db.query<{ n: number }>(
      "select count(*)::int as n from private.oauth_connections c join channels ch on ch.id=c.channel_id where ch.external_channel_id=$1 and c.status='connected'",
      [PAGE],
    );
    expect(grants.rows[0].n).toBe(2);
  });

  it("will not let a second workspace seize a connected page", async () => {
    await createMetaPending(
      ownerB,
      B,
      "facebook",
      "m-seize",
      "t-seize",
      "n-seize",
      PAGE,
    );
    await user(ownerB);
    await expect(
      db.query("select * from public.oauth_complete($1,$2)", [
        "t-seize",
        "n-seize",
      ]),
    ).rejects.toThrow(/channel_already_connected/);
    await admin();
  });
});
