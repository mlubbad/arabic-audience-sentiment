/**
 * `svc_monitor_channel_freshness`: what the external monitor reads to decide
 * whether collection is arriving, channel by channel.
 *
 * The monitor used to read the newest prediction on the whole platform, so
 * one healthy channel hid any number of stalled ones. Here one channel is
 * fresh and the others are stale in each of the ways production showed on
 * 2026-10-16, including the one the console labels 'collecting' because its
 * job is queued again and again. Only service_role may read it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const HOME = "00000000-0000-4000-8000-000000000001";
const ELSEWHERE = "00000000-0000-4000-8000-000000000002";
type Channel = { workspace_id: string; channel_id: string };
let db: PGlite;

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function freshness() {
  const { rows } = await db.query<{ r: unknown }>(
    "select public.svc_monitor_channel_freshness() as r",
  );
  return rows[0]!.r;
}

async function imported(n: number, title: string): Promise<Channel> {
  await as("authenticated", ADMIN);
  const external = `UC${"B".repeat(20)}${String(n).padStart(2, "0")}`;
  const { rows } = await db.query<{ r: Channel }>(
    "select public.admin_import_channel($1,$2) as r",
    [external, title],
  );
  await db.exec("reset role");
  const c = rows[0]!.r;
  await db.query(
    "update channels set catalogued_at = now() where workspace_id=$1 and id=$2",
    [c.workspace_id, c.channel_id],
  );
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and channel_id=$2 and type='discover'",
    [c.workspace_id, c.channel_id],
  );
  return c;
}

async function selected(c: Channel, name: string, hoursAgo: number) {
  const { rows } = await db.query<{ id: string }>(
    `insert into videos(workspace_id, channel_id, external_video_id, title, published_at, comments_state)
     values ($1,$2,$3,$3, now() - interval '10 days', 'open') returning id`,
    [c.workspace_id, c.channel_id, name],
  );
  await db.query(
    `insert into video_selections(workspace_id, channel_id, video_id, selected_at)
     values ($1,$2,$3, now() - make_interval(hours => $4::int))`,
    [c.workspace_id, c.channel_id, rows[0]!.id, hoursAgo],
  );
}

async function collect(
  c: Channel,
  status: string,
  hoursAgo: number,
  error: string | null = null,
) {
  await db.query(
    `insert into sync_runs(workspace_id, channel_id, mode, source, status, started_at, ended_at, error_code)
     values ($1,$2,'collect','test',$3, now() - make_interval(hours => $4::int), now() - make_interval(hours => $4::int), $5)`,
    [c.workspace_id, c.channel_id, status, hoursAgo, error],
  );
}

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
  for (const [w, name, user] of [
    [HOME, "Home", ADMIN],
    [ELSEWHERE, "Elsewhere", OTHER],
  ] as const) {
    await db.query(
      "insert into workspaces(id,name,created_by,created_at) values ($1,$2,$3,now()-interval '1 day')",
      [w, name, user],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      w,
      user,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,$2)",
      [w, name],
    );
  }
  await db.query(
    "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'owner','active',now(),now()+interval '30 days')",
    [HOME],
  );

  // Fresh: collected an hour ago, after failures before that.
  const fresh = await imported(1, "Fresh");
  await selected(fresh, "fresh-v", 24 * 10);
  await collect(fresh, "blocked", 30, "quota_exceeded");
  await collect(fresh, "partial", 1, "quota_exceeded");

  // Stale: the last good collection was three days ago, blocked since.
  const lapsed = await imported(2, "Lapsed");
  await selected(lapsed, "lapsed-v", 24 * 10);
  await collect(lapsed, "succeeded", 72);
  await collect(lapsed, "blocked", 2, "quota_exceeded");

  // Stale, never: selected three days ago and blocked on every attempt.
  const never = await imported(3, "Never");
  await selected(never, "never-v", 72);
  for (const h of [70, 40, 10, 1])
    await collect(never, "blocked", h, "quota_exceeded");

  // Stale, never, and the console calls it 'collecting': its next attempt
  // is queued, as it is every hour.
  const queued = await imported(4, "Queued");
  await selected(queued, "queued-v", 72);
  await collect(queued, "blocked", 3, "channel_not_connected");
  await db.query(
    "insert into jobs(workspace_id, channel_id, type, dedupe_key) values ($1,$2,'collect','collect-queued')",
    [queued.workspace_id, queued.channel_id],
  );

  // Not stale yet: selected an hour ago, never collected.
  await selected(await imported(5, "Just selected"), "new-v", 1);

  // Not collected: paused, however old its last success.
  const paused = await imported(6, "Paused");
  await selected(paused, "paused-v", 24 * 10);
  await collect(paused, "succeeded", 24 * 9);
  await db.query(
    "update channels set paused_at = now() where workspace_id=$1 and id=$2",
    [paused.workspace_id, paused.channel_id],
  );

  // Not collected: catalogued, nothing selected.
  await imported(7, "Waiting");
});

afterAll(async () => {
  await db?.close();
});

describe("svc_monitor_channel_freshness", () => {
  it("counts each stalled channel, not the platform's newest result", async () => {
    await db.exec("reset role; set role service_role");
    expect(await freshness()).toEqual({ collected: 5, stale: 3, never: 2 });
  });

  it("the console labels the queued stale channel 'collecting', which the monitor does not trust", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ state: string }>(
      `select s.state from private.admin_channel_states() s
         join channels c on c.id = s.channel_id where c.title = 'Queued'`,
    );
    expect(rows.map((r) => r.state)).toEqual(["collecting"]);
  });

  it("answers counts only, naming no channel", async () => {
    await db.exec("reset role; set role service_role");
    expect(Object.keys((await freshness()) as object).sort()).toEqual([
      "collected",
      "never",
      "stale",
    ]);
  });

  it.each([
    ["a member of another workspace", "authenticated", OTHER],
    ["the platform admin's user key", "authenticated", ADMIN],
    ["anon", "anon", null],
  ] as const)("refuses %s", async (_who, role, sub) => {
    await as(role, sub);
    await expect(freshness()).rejects.toThrow(/permission denied/);
  });
});
