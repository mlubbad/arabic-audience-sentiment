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
import {
  AdminChannelsConsoleSchema,
  AdminConsoleOverviewSchema,
} from "@sentiment/contracts";

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
      paused: 0,
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

describe("admin_channels_console", () => {
  type Row = {
    title: string | null;
    state: string;
    mine: boolean;
    owner_email: string | null;
    videos: number;
    selected: number;
    comments: number;
    analysed: number;
    auto_initial: number | null;
    auto_daily: number | null;
    last_error: string | null;
  };
  async function rows() {
    const { rows } = await db.query<{ r: unknown }>(
      "select public.admin_channels_console() as r",
    );
    return AdminChannelsConsoleSchema.parse(rows[0]!.r) as Row[];
  }

  beforeAll(async () => {
    // A customer's own channel, in their personal workspace.
    await db.exec("reset role");
    const { rows: ws } = await db.query<{ id: string; client: string }>(
      `select w.id, c.id as client from workspaces w join clients c on c.workspace_id = w.id
        where w.created_by = $1 limit 1`,
      [OTHER],
    );
    await db.query(
      "insert into channels(workspace_id, client_id, external_channel_id, title) values ($1,$2,'UCBBBBBBBBBBBBBBBBBBBBB1','Customer channel')",
      [ws[0]!.id, ws[0]!.client],
    );
  });

  it("gives every channel the state the home counts, and the home's numbers", async () => {
    await as("authenticated", ADMIN);
    const list = await rows();
    const by = (t: string) => list.find((r) => r.title === t)!;
    expect(list).toHaveLength(8);
    expect(
      [
        "Cataloguing",
        "Collecting",
        "Failing",
        "New",
        "Waiting",
        "Stale",
        "Healthy",
      ].map((t) => by(t).state),
    ).toEqual([
      "cataloguing",
      "collecting",
      "failing",
      "new",
      "waiting",
      "stale",
      "healthy",
    ]);
    expect(by("Failing").last_error).toBe("quota_exceeded");
    expect(by("Healthy")).toMatchObject({
      videos: 1,
      selected: 1,
      comments: 100,
      analysed: 90,
      auto_initial: 20,
      auto_daily: 5,
    });
  });

  it("tells the owner's channels from a customer's, and names the customer", async () => {
    await as("authenticated", ADMIN);
    const list = await rows();
    expect(list.find((r) => r.title === "Healthy")).toMatchObject({
      mine: true,
      owner_email: "owner@example.com",
    });
    expect(list.find((r) => r.title === "Customer channel")).toMatchObject({
      mine: false,
      owner_email: "customer@example.com",
      state: "new",
      auto_initial: null,
    });
  });

  it("answers no one but a platform admin, within its own 30 s", async () => {
    await as("authenticated", OTHER);
    await expect(rows()).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(rows()).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    const { rows: cfg } = await db.query<{ config: string[] }>(
      "select proconfig as config from pg_proc where proname = 'admin_channels_console'",
    );
    expect(cfg[0]!.config).toContain("statement_timeout=30s");
  });
});

describe("pausing a channel's collection", () => {
  async function channel(title: string) {
    await db.exec("reset role");
    const { rows } = await db.query<{ ws: string; id: string }>(
      "select workspace_id as ws, id from channels where title=$1",
      [title],
    );
    return rows[0]!;
  }
  async function setPaused(ids: string[], paused: boolean) {
    const { rows } = await db.query<{
      r: { changed: number; cancelled_jobs: number };
    }>("select public.admin_set_channels_paused($1::uuid[], $2) as r", [
      ids,
      paused,
    ]);
    return rows[0]!.r;
  }
  async function queued(ws: string, type: string) {
    return count(
      "select count(*)::int as n from jobs where workspace_id=$1 and type=$2 and status='queued'",
      [ws, type],
    );
  }
  async function count(sql: string, params: unknown[]) {
    await db.exec("reset role");
    const { rows } = await db.query<{ n: number }>(sql, params);
    return rows[0]!.n;
  }

  it("cancels queued work, counts the channel as paused, and records who did it", async () => {
    const col = await channel("Collecting");
    expect(await queued(col.ws, "collect")).toBe(1);
    await as("authenticated", ADMIN);
    expect(await setPaused([col.id], true)).toEqual({
      changed: 1,
      cancelled_jobs: 1,
    });
    expect(await queued(col.ws, "collect")).toBe(0);
    await as("authenticated", ADMIN);
    const o = await overview();
    expect(o.states.paused).toBe(1);
    expect(o.states.collecting).toBe(0);
    expect(o.activity[0]).toMatchObject({
      action: "channel_paused",
      actor_email: "owner@example.com",
    });
    // Pausing it again changes nothing.
    expect(await setPaused([col.id], true)).toEqual({
      changed: 0,
      cancelled_jobs: 0,
    });
  });

  it("the scheduler starts nothing for a paused channel, and picks it up again once resumed", async () => {
    const stale = await channel("Stale");
    await as("authenticated", ADMIN);
    await setPaused([stale.id], true);
    await db.exec("reset role");
    await db.query("select private.schedule_due_work($1)", [stale.ws]);
    expect(await queued(stale.ws, "collect")).toBe(0);

    await as("authenticated", ADMIN);
    expect(await setPaused([stale.id], false)).toEqual({
      changed: 1,
      cancelled_jobs: 0,
    });
    await db.exec("reset role");
    await db.query("select private.schedule_due_work($1)", [stale.ws]);
    expect(await queued(stale.ws, "collect")).toBe(1);
  });

  it("the automatic selection selects nothing while paused", async () => {
    // Published after the first selection's watermark: a video the daily
    // selection would take.
    const wait = await channel("Waiting");
    await db.query(
      `insert into videos(workspace_id, channel_id, external_video_id, title, published_at, comments_state)
       values ($1,$2,'wait-v','wait-v', now() + interval '1 hour', 'open')`,
      [wait.ws, wait.id],
    );
    await as("authenticated", ADMIN);
    await setPaused([wait.id], true);
    await db.exec("reset role");
    const picked = async () =>
      (
        await db.query<{ n: number }>(
          "select private.auto_select_videos($1,$2) as n",
          [wait.ws, wait.id],
        )
      ).rows[0]!.n;
    expect(await picked()).toBe(0);
    await as("authenticated", ADMIN);
    await setPaused([wait.id], false);
    await db.exec("reset role");
    expect(await picked()).toBe(1);
  });

  it("answers no one but a platform admin, and refuses an empty list", async () => {
    const ok = await channel("Healthy");
    await as("authenticated", OTHER);
    await expect(setPaused([ok.id], true)).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(setPaused([ok.id], true)).rejects.toThrow(/permission denied/);
    await as("authenticated", ADMIN);
    await expect(setPaused([], true)).rejects.toThrow(/invalid_request/);
  });
});

describe("bulk channel actions", () => {
  async function ids(...titles: string[]) {
    await db.exec("reset role");
    const { rows } = await db.query<{ id: string; title: string }>(
      "select id, title from channels where title = any($1)",
      [titles],
    );
    return titles.map((t) => rows.find((r) => r.title === t)!.id);
  }
  async function work(channels: string[], kind: string) {
    const { rows } = await db.query<{ r: { queued: number; skipped: number } }>(
      "select public.admin_request_channel_work($1::uuid[], $2) as r",
      [channels, kind],
    );
    return rows[0]!.r;
  }

  it("queues a collection only where one can run, and says how many it skipped", async () => {
    const [healthy, waiting, fresh, paused] = await ids(
      "Healthy",
      "Waiting",
      "New",
      "Collecting",
    );
    await as("authenticated", ADMIN);
    // Healthy and Waiting have selected videos; New has none; Collecting is
    // paused (the pause tests above).
    expect(
      await work([healthy!, waiting!, fresh!, paused!], "collect"),
    ).toEqual({ queued: 2, skipped: 2 });
    // Asked again: the queued job is the answer.
    expect(await work([healthy!], "collect")).toEqual({
      queued: 0,
      skipped: 1,
    });
    const o = await overview();
    expect(o.activity[0]).toMatchObject({
      action: "channel_collect_requested",
      actor_email: "owner@example.com",
    });
  });

  it("queues a fresh catalogue run", async () => {
    const [failing] = await ids("Failing");
    await as("authenticated", ADMIN);
    expect(await work([failing!], "discover")).toEqual({
      queued: 1,
      skipped: 0,
    });
    await db.exec("reset role");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from jobs where channel_id=$1 and type='discover' and status='queued'",
      [failing],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("sets the automatic selection numbers, creating them where there were none", async () => {
    const [customer, healthy] = await ids("Customer channel", "Healthy");
    await as("authenticated", ADMIN);
    const { rows } = await db.query<{ r: { changed: number } }>(
      "select public.admin_set_auto_selection($1::uuid[], 10, 3) as r",
      [[customer, healthy]],
    );
    expect(rows[0]!.r).toEqual({ changed: 2 });
    const { rows: list } = await db.query<{ r: unknown }>(
      "select public.admin_channels_console() as r",
    );
    const parsed = AdminChannelsConsoleSchema.parse(list[0]!.r);
    for (const t of ["Customer channel", "Healthy"])
      expect(parsed.find((c) => c.title === t)).toMatchObject({
        auto_initial: 10,
        auto_daily: 3,
      });
    await db.exec("reset role");
    const { rows: owner } = await db.query<{ created_by: string }>(
      "select created_by from private.channel_auto_selection where channel_id=$1",
      [customer],
    );
    // In the name of the workspace's creator, as an import's selection is.
    expect(owner[0]!.created_by).toBe(OTHER);
  });

  it("refuses a bad request and anyone but a platform admin", async () => {
    const [healthy] = await ids("Healthy");
    await as("authenticated", ADMIN);
    await expect(work([healthy!], "analyse")).rejects.toThrow(
      /invalid_request/,
    );
    await expect(
      db.query("select public.admin_set_auto_selection($1::uuid[], 201, 3)", [
        [healthy],
      ]),
    ).rejects.toThrow(/invalid_request/);
    await as("authenticated", OTHER);
    await expect(work([healthy!], "collect")).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select public.admin_set_auto_selection($1::uuid[], 5, 1)", [
        [healthy],
      ]),
    ).rejects.toThrow(/forbidden/);
  });
});
