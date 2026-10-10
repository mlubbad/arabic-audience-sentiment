/**
 * `admin_daily_digest`: the owner's morning summary, kept as one snapshot a
 * day by `private.record_admin_digest()`.
 *
 * The migration records the first snapshot; a failing channel is named with
 * its error; the biggest weekly sentiment change comes from the comparison
 * page's counts and needs a large enough sample in both weeks; a second
 * recording the same day replaces the first, and the read gives the latest
 * snapshot with the one before it. Only a platform admin reads it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminDailyDigestSchema,
  type AdminDailyDigest,
} from "@sentiment/contracts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const HOME = "00000000-0000-4000-8000-000000000001";
let db: PGlite;

type Channel = { workspace_id: string; channel_id: string };

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function digest(): Promise<AdminDailyDigest> {
  await as("authenticated", ADMIN);
  const { rows } = await db.query<{ r: unknown }>(
    "select public.admin_daily_digest() as r",
  );
  await db.exec("reset role");
  return AdminDailyDigestSchema.parse(rows[0]!.r);
}

async function imported(n: number, title: string): Promise<Channel> {
  await as("authenticated", ADMIN);
  const external = `UC${"D".repeat(20)}${String(n).padStart(2, "0")}`;
  const { rows } = await db.query<{ r: Channel }>(
    "select public.admin_import_channel($1,$2) as r",
    [external, title],
  );
  await db.exec("reset role");
  return rows[0]!.r;
}

/** Counts as the comparison page keeps them, for one day `daysAgo`. */
async function cell(
  c: Channel,
  daysAgo: number,
  positive: number,
  negative: number,
) {
  await db.query(
    `insert into private.channel_compare_cells(workspace_id, channel_id, day, topic_key,
       comments, analysed, positive, negative, neutral, mixed)
     values ($1,$2,(now() at time zone 'UTC')::date - $3::int, null,$4,$4,$5,$6,0,0)`,
    [
      c.workspace_id,
      c.channel_id,
      daysAgo,
      positive + negative,
      positive,
      negative,
    ],
  );
}

let failing: Channel;
let mover: Channel;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

  await db.query(
    "insert into auth.users(id,email) values ($1,'owner@example.com'),($2,'customer@example.com')",
    [ADMIN, OTHER],
  );
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
  await db.query(
    "insert into workspaces(id,name,created_by,created_at) values ($1,'Home',$2,now()-interval '1 day')",
    [HOME, ADMIN],
  );
  await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
    HOME,
    ADMIN,
  ]);
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'Home')",
    [HOME],
  );
  await db.query(
    "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'owner','active',now(),now()+interval '30 days')",
    [HOME],
  );

  // Failing: catalogued, its latest run failed an hour ago.
  failing = await imported(1, "Failing");
  await db.query(
    "update channels set catalogued_at = now() where workspace_id=$1 and id=$2",
    [failing.workspace_id, failing.channel_id],
  );
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and channel_id=$2 and type='discover'",
    [failing.workspace_id, failing.channel_id],
  );
  await db.query(
    `insert into sync_runs(workspace_id, channel_id, mode, source, status, started_at, ended_at, error_code)
     values ($1,$2,'discover','test','failed', now() - interval '1 hour', now() - interval '1 hour', 'quota_exceeded')`,
    [failing.workspace_id, failing.channel_id],
  );

  // Mover: last week 20 positive, 20 negative (0); this week 30 positive,
  // 10 negative (+50).
  mover = await imported(2, "Mover");
  await cell(mover, 9, 20, 20);
  await cell(mover, 2, 30, 10);
  // Too few to say: 5 and 5 comments.
  const small = await imported(3, "Small");
  await cell(small, 9, 0, 5);
  await cell(small, 2, 5, 0);
});

afterAll(async () => {
  await db?.close();
});

describe("the daily digest", () => {
  it("the migration recorded a first snapshot, with nothing yet to compare it to", async () => {
    const d = await digest();
    expect(d.latest).not.toBeNull();
    expect(d.previous).toBeNull();
  });

  it("names the failing channel with its error, and the biggest sentiment change with a large enough sample", async () => {
    await db.query("select private.record_admin_digest()");
    const body = (await digest()).latest!.body;
    expect(body.states.failing).toBe(1);
    expect(body.failing).toEqual([
      {
        channel_id: failing.channel_id,
        title: "Failing",
        handle: null,
        error_code: "quota_exceeded",
      },
    ]);
    expect(body.failed_runs).toBe(1);
    expect(body.imported).toBe(3);
    expect(body.movers).toEqual([
      {
        channel_id: mover.channel_id,
        title: "Mover",
        handle: null,
        change: 50,
      },
    ]);
  });

  it("keeps one snapshot a day, gives the one before it, and forgets past thirty days", async () => {
    await db.query("select private.record_admin_digest()");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from private.admin_digests",
        )
      ).rows[0]!.n,
    ).toBe(1);

    await db.query(
      `insert into private.admin_digests(day, recorded_at, body)
       select day - 1, recorded_at - interval '1 day', body from private.admin_digests`,
    );
    await db.query(
      `insert into private.admin_digests(day, recorded_at, body)
       select day - 40, recorded_at - interval '40 days', body
         from private.admin_digests order by day desc limit 1`,
    );
    await db.query("select private.record_admin_digest()");
    const d = await digest();
    expect(d.previous).not.toBeNull();
    expect(Date.parse(d.previous!.day)).toBeLessThan(Date.parse(d.latest!.day));
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from private.admin_digests",
        )
      ).rows[0]!.n,
    ).toBe(2);
  });
});

describe("who may read it", () => {
  it("refuses everyone but a platform admin, and the snapshots are out of the browser's reach", async () => {
    await as("authenticated", OTHER);
    await expect(
      db.query("select public.admin_daily_digest()"),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select * from private.admin_digests"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select private.record_admin_digest()"),
    ).rejects.toThrow(/permission denied/);
    await as("anon", null);
    await expect(
      db.query("select public.admin_daily_digest()"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
