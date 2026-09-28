/**
 * `register_public_channel`: the row behind the link-or-search door.
 *
 * Same rules as `register_channel`, plus the metadata the lookup found: the
 * role and tenant checks, the syntactically-valid UC id, and the refusal that
 * keeps a second client of the same workspace from filing the channel again.
 * A status is never written: the table's `public_unverified` default is the
 * whole point — only a completed OAuth flow says `connected`.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const viewer = "10000000-0000-4000-8000-000000000004";
const ID = "UCTPIL6f7yNpK8yc-H3cEtFg";
let db: PGlite;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const admin = () => db.exec("reset role");

describe("register_public_channel", () => {
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
      "insert into memberships values ($1,$3,'workspace_owner'),($2,$4,'workspace_owner'),($1,$5,'viewer')",
      [A, B, ownerA, ownerB, viewer],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'owner','active',now(),now()+interval '30 days'),
              ($2,'free','active',now(),now()+interval '30 days')`,
      [A, B],
    );
  });

  it("refuses a direct registration when the workspace plan disallows public channels", async () => {
    await user(ownerB);
    await expect(
      db.query("select register_public_channel($1,$1,$2,null,null)", [B, ID]),
    ).rejects.toThrow(/public_channels_not_allowed_on_plan/);
  });
  afterAll(async () => {
    await db?.close();
  });

  it("files the channel with its metadata, and nothing but public status", async () => {
    await user(ownerA);
    const { rows } = await db.query<{
      status: string;
      handle: string | null;
      title: string | null;
    }>("select * from register_public_channel($1,$2,$3,$4,$5)", [
      A,
      A,
      ID,
      "@alaa_jaber_official",
      "علاء جابر",
    ]);
    expect(rows[0].status).toBe("public_unverified");
    expect(rows[0].handle).toBe("@alaa_jaber_official");
    expect(rows[0].title).toBe("علاء جابر");
  });

  it("re-adding the same channel is the existing row, not a duplicate", async () => {
    await user(ownerA);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from channels where workspace_id=$1 and external_channel_id=$2",
      [A, ID],
    );
    expect(rows[0].n).toBe(1);
    const again = await db.query(
      "select id from register_public_channel($1,$2,$3,$4,$5)",
      [A, A, ID, null, null],
    );
    expect(again.rows.length).toBe(1);
  });

  it("refuses a channel that is not a well-formed UC id", async () => {
    await user(ownerA);
    await expect(
      db.query("select register_public_channel($1,$2,$3,$4,$5)", [
        A,
        A,
        "not-an-id",
        null,
        null,
      ]),
    ).rejects.toThrow(/invalid_channel_id/);
  });

  it("refuses a non-member and a viewer", async () => {
    await user(ownerB);
    await expect(
      db.query("select register_public_channel($1,$2,$3,$4,$5)", [
        A,
        A,
        "UCaaaaaaaaaaaaaaaaaaaaaa",
        null,
        null,
      ]),
    ).rejects.toThrow(/forbidden|permission denied/i);
    await user(viewer);
    await expect(
      db.query("select register_public_channel($1,$2,$3,$4,$5)", [
        A,
        A,
        "UCaaaaaaaaaaaaaaaaaaaaaa",
        null,
        null,
      ]),
    ).rejects.toThrow(/forbidden|permission denied/i);
  });

  it("refuses a second client of the same workspace claiming the channel", async () => {
    await admin();
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$2,'A2')",
      ["00000000-0000-4000-8000-000000000003", A],
    );
    await user(ownerA);
    await expect(
      db.query("select register_public_channel($1,$2,$3,$4,$5)", [
        A,
        "00000000-0000-4000-8000-000000000003",
        ID,
        null,
        null,
      ]),
    ).rejects.toThrow(/channel_claimed_by_other_client/);
  });

  it("blanks stay null, and overlong metadata is refused, not truncated", async () => {
    await user(ownerA);
    await db.query("select register_public_channel($1,$2,$3,$4,$5)", [
      A,
      A,
      "UCaaaaaaaaaaaaaaaaaaaaaa",
      "   ",
      "",
    ]);
    const stored = await db.query<{
      handle: string | null;
      title: string | null;
    }>(
      "select handle, title from channels where workspace_id=$1 and external_channel_id='UCaaaaaaaaaaaaaaaaaaaaaa'",
      [A],
    );
    expect(stored.rows[0].handle).toBeNull();
    expect(stored.rows[0].title).toBeNull();
    await expect(
      db.query("select register_public_channel($1,$2,$3,$4,$5)", [
        A,
        A,
        "UCbbbbbbbbbbbbbbbbbbbbbb",
        "@x".repeat(40),
        null,
      ]),
    ).rejects.toThrow(/invalid_channel_handle/);
  });

  it("a channel added this way can go straight to discovery", async () => {
    // The point of the door: no grant, and the catalogue still starts. The
    // worker's side of that promise is the claim's external_channel_id.
    await admin();
    await db.query(
      "update subscriptions set plan_key='pilot' where workspace_id=$1",
      [A],
    );
    await user(ownerA);
    const { rows } = await db.query<{ job: string }>(
      "select request_discovery($1, channels.id) as job from channels where workspace_id=$1 and external_channel_id=$2",
      [A, ID],
    );
    expect(rows[0].job).toBeTruthy();
    const job = await db.query<{ type: string; status: string }>(
      "select type, status from jobs where id=$1",
      [rows[0].job],
    );
    expect(job.rows[0].type).toBe("discover");
    expect(job.rows[0].status).toBe("queued");
    await admin();
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [A],
    );
  });

  it("owner can remove a channel, which cleans up jobs and deletes the channel row", async () => {
    await user(ownerA);
    const ch = await db.query<{ id: string }>(
      "select id from channels where workspace_id=$1 and external_channel_id=$2",
      [A, ID],
    );
    const channelId = ch.rows[0].id;

    // Check we have an active job for it
    const activeJobsBefore = await db.query<{ id: string; status: string }>(
      "select id, status from jobs where channel_id=$1 and status in ('queued', 'leased')",
      [channelId],
    );
    expect(activeJobsBefore.rows.length).toBeGreaterThan(0);

    // Remove the channel
    await db.query("select remove_channel($1, $2)", [A, channelId]);

    // Channel should be gone
    const chAfter = await db.query(
      "select id from channels where workspace_id=$1 and id=$2",
      [A, channelId],
    );
    expect(chAfter.rows.length).toBe(0);

    // Jobs should also be deleted
    const jobsAfter = await db.query(
      "select id, status from jobs where channel_id=$1",
      [channelId],
    );
    expect(jobsAfter.rows.length).toBe(0);
  });

  it("non-owner is refused from removing a channel", async () => {
    // Re-register channel
    await user(ownerA);
    const { rows } = await db.query<{
      register_public_channel: { id: string };
    }>("select register_public_channel($1,$2,$3,$4,$5)", [
      A,
      A,
      ID,
      "@removetest",
      "Remove Test",
    ]);
    const channelId = rows[0].register_public_channel.id;

    // Viewer tries to remove
    await user(viewer);
    await expect(
      db.query("select remove_channel($1, $2)", [A, channelId]),
    ).rejects.toThrow(/forbidden/);

    // Other workspace owner tries to remove
    await user(ownerB);
    await expect(
      db.query("select remove_channel($1, $2)", [A, channelId]),
    ).rejects.toThrow(/forbidden/);
  });
});
