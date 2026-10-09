/**
 * `admin_console_overview`: the owner console's home in one read, and
 * `private.admin_channel_states`, the one place a channel's state is named.
 *
 * Seven imported channels are put in the seven states; the overview counts
 * them, lists the failing and stale ones for the owner's attention, sums the
 * funnel from the precomputed stats, and shows the latest audit rows. Only a
 * platform admin may read it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminConsoleOverviewSchema } from "@sentiment/contracts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const HOME = "00000000-0000-4000-8000-000000000001";
let db: PGlite;

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function overview() {
  const { rows } = await db.query<{ r: unknown }>(
    "select public.admin_console_overview() as r",
  );
  return AdminConsoleOverviewSchema.parse(rows[0]!.r);
}

/** One imported channel: its workspace and channel ids. */
async function imported(n: number, title: string) {
  await as("authenticated", ADMIN);
  const external = `UC${"A".repeat(20)}${String(n).padStart(2, "0")}`;
  const { rows } = await db.query<{
    r: { workspace_id: string; channel_id: string };
  }>("select public.admin_import_channel($1,$2) as r", [external, title]);
  await db.exec("reset role");
  return rows[0]!.r;
}

async function catalogued(c: { workspace_id: string; channel_id: string }) {
  await db.query(
    "update channels set catalogued_at = now() where workspace_id=$1 and id=$2",
    [c.workspace_id, c.channel_id],
  );
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and channel_id=$2 and type='discover'",
    [c.workspace_id, c.channel_id],
  );
}

async function selectedVideo(
  c: { workspace_id: string; channel_id: string },
  name: string,
  comments = 0,
  analysed = 0,
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into videos(workspace_id, channel_id, external_video_id, title, published_at, comments_state)
     values ($1,$2,$3,$3, now() - interval '10 days', 'open') returning id`,
    [c.workspace_id, c.channel_id, name],
  );
  const video = rows[0]!.id;
  await db.query(
    "insert into video_selections(workspace_id, channel_id, video_id) values ($1,$2,$3)",
    [c.workspace_id, c.channel_id, video],
  );
  await db.query(
    "insert into private.video_comment_stats(workspace_id, video_id, total, analysed) values ($1,$2,$3,$4)",
    [c.workspace_id, video, comments, analysed],
  );
}

async function run(
  c: { workspace_id: string; channel_id: string },
  mode: string,
  status: string,
  hoursAgo: number,
  error: string | null = null,
) {
  await db.query(
    `insert into sync_runs(workspace_id, channel_id, mode, source, status, started_at, ended_at, error_code)
     values ($1,$2,$3,'test',$4, now() - make_interval(hours => $5::int), now() - make_interval(hours => $5::int), $6)`,
    [c.workspace_id, c.channel_id, mode, status, hoursAgo, error],
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

  // Cataloguing: imported, its first catalogue run still queued.
  await imported(1, "Cataloguing");

  // Collecting: catalogued, a video selected, a collection queued.
  const col = await imported(2, "Collecting");
  await catalogued(col);
  await selectedVideo(col, "col-v");
  await db.query(
    "insert into jobs(workspace_id, channel_id, type, dedupe_key) values ($1,$2,'collect','collect-test')",
    [col.workspace_id, col.channel_id],
  );

  // Failing: its latest run failed.
  const fail = await imported(3, "Failing");
  await catalogued(fail);
  await run(fail, "discover", "succeeded", 5);
  await run(fail, "discover", "failed", 1, "quota_exceeded");

  // New: never catalogued, no run queued.
  const fresh = await imported(4, "New");
  await db.query(
    "update jobs set status='cancelled' where workspace_id=$1 and type='discover'",
    [fresh.workspace_id],
  );

  // Waiting: catalogued, nothing selected.
  await catalogued(await imported(5, "Waiting"));

  // Stale: selected videos, last good collection three days ago.
  const stale = await imported(6, "Stale");
  await catalogued(stale);
  await selectedVideo(stale, "stale-v", 40, 10);
  await run(stale, "collect", "succeeded", 72);

  // Healthy: collected an hour ago.
  const ok = await imported(7, "Healthy");
  await catalogued(ok);
  await selectedVideo(ok, "ok-v", 100, 90);
  await run(ok, "collect", "succeeded", 1);
});

afterAll(async () => {
  await db?.close();
});

describe("admin_console_overview", () => {
  it("counts every channel in exactly one state", async () => {
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.channels).toBe(7);
    expect(o.states).toEqual({
      cataloguing: 1,
      collecting: 1,
      failing: 1,
      new: 1,
      waiting: 1,
      stale: 1,
      healthy: 1,
    });
    expect(o.users).toBe(2);
    expect(o.workspaces).toBeGreaterThanOrEqual(8);
  });

  it("puts failing before stale in the attention list, with the error and the workspace", async () => {
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.attention.map((a) => [a.title, a.state, a.error_code])).toEqual([
      ["Failing", "failing", "quota_exceeded"],
      ["Stale", "stale", null],
    ]);
    expect(o.attention[0]!.workspace_name).toBe("Failing");
  });

  it("sums the funnel from the precomputed stats", async () => {
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.funnel).toEqual({
      videos: 3,
      selected: 3,
      comments: 140,
      analysed: 100,
    });
  });

  it("shows the latest audit rows, newest first, with who did them", async () => {
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.activity.length).toBeGreaterThan(0);
    expect(o.activity[0]).toMatchObject({
      action: "channel_imported",
      actor_email: "owner@example.com",
      workspace_name: "Healthy",
    });
  });

  it("reports the worker's queue", async () => {
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.worker.fresh).toBe(false);
    expect(o.worker.queued).toBe(2);
    expect(o.worker.running).toBe(0);
  });

  it("answers no one but a platform admin, and the states helper is out of the browser's reach", async () => {
    await as("authenticated", OTHER);
    await expect(overview()).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select * from private.admin_channel_states()"),
    ).rejects.toThrow(/permission denied/);
    await as("anon", null);
    await expect(overview()).rejects.toThrow(/permission denied/);
  });

  it("carries its own 30 s statement timeout", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ config: string[] }>(
      "select proconfig as config from pg_proc where proname = 'admin_console_overview'",
    );
    expect(rows[0]!.config).toContain("statement_timeout=30s");
  });
});
