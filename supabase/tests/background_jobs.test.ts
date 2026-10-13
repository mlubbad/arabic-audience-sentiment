/**
 * Background jobs that finish one unit at a time and say when they fail
 * (20261025000000).
 *
 * The comparison recount and the nightly stats reconcile each looped over
 * every workspace in one cron statement; a 2-minute cancel rolled the whole
 * run back, every run, and nothing in the console showed it (2026-10-13).
 * Here each step counts one channel (or reconciles one workspace), a failed
 * run that could not write its own error is charged to the unit the order
 * puts first on the next run, and the owner reads both through
 * `admin_background_jobs()` and the comparison rows' `count_state`.
 *
 * PGlite has no pg_cron; a `cron` schema with the two tables the functions
 * read stands in for it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminChannelsCompareSchema } from "@sentiment/contracts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";
const A1 = "50000000-0000-4000-8000-000000000001";
const A2 = "50000000-0000-4000-8000-000000000002";
const B1 = "50000000-0000-4000-8000-000000000003";
const TIMEOUT =
  "ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL statement ...";
let db: PGlite;

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0]!;
const step = async () =>
  (await one<{ r: string }>("select private.channel_compare_step() as r")).r;
const reconcileStep = async () =>
  (await one<{ r: string }>("select private.video_stats_reconcile_step() as r"))
    .r;
const unit = (channel: string) =>
  one<{
    dirty: boolean;
    counted: boolean;
    attempts: number;
    last_error: string | null;
    backed_off: boolean;
  }>(
    `select dirty_since is not null as dirty, refreshed_at is not null as counted, attempts,
            last_error, coalesce(next_attempt_at > now(), false) as backed_off
       from private.channel_compare_units where channel_id = $1`,
    [channel],
  );
let runid = 0;
async function cronRun(job: string, status: "failed" | "succeeded") {
  runid++;
  await db.query(
    `insert into cron.job_run_details(runid, jobid, status, return_message, start_time, end_time)
     select $1, jobid, $2, $3, now() - interval '1 minute', now() - interval '59 seconds'
       from cron.job where jobname = $4`,
    [runid, status, status === "failed" ? TIMEOUT : "1 row", job],
  );
}
async function as(sub: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sub]);
  await db.exec("set role authenticated");
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
  await db.query("insert into auth.users(id,email) values ($1,$2),($3,$4)", [
    ADMIN,
    "owner@example.com",
    OTHER,
    "customer@example.com",
  ]);
  // The workspaces and channels exist before the migration, as in production.
  const files = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const before = files.filter((f) => f < "20261025000000");
  for (const f of before)
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
  for (const [w, channels] of [
    [A, [A1, A2]],
    [B, [B1]],
  ] as const) {
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [w, OTHER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [w],
    );
    await db.query(
      `insert into analysis_runs(workspace_id,model_id,revision_sha,preprocessing_version,status)
       values ($1,'m','sha','v1','succeeded')`,
      [w],
    );
    for (const c of channels) {
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status,active_analysis_key)
         values ($1,$2,$2,$3,'connected','k')`,
        [c, w, `UC${c.slice(-22)}`],
      );
      const { rows: v } = await db.query<{ id: string }>(
        `insert into videos(workspace_id,channel_id,external_video_id,title)
         values ($1,$2,$3,'v') returning id`,
        [w, c, `v-${c}`],
      );
      for (const [i, label] of ["positive", "negative", "positive"].entries()) {
        const { rows: cm } = await db.query<{ id: string }>(
          `insert into comments(workspace_id,video_id,external_comment_id,text_raw,text_plain,
             content_hash,timestamp_precision,source,published_at,author_channel_id)
           values ($1,$2,$3,'t','t',$4,'second','test',now()-interval '1 day','UCviewer')
           returning id`,
          [w, v[0]!.id, `c-${c}-${i}`, `h-${c}-${i}`],
        );
        await db.query(
          `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,
             analysis_key,status,label)
           select $1,$2,$3,id,'k','succeeded',$4 from analysis_runs where workspace_id=$1`,
          [w, cm[0]!.id, `h-${c}-${i}`, label],
        );
      }
    }
  }
  for (const f of files.filter((f) => f >= "20261025000000"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(`create schema cron;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text,
      command text, active boolean not null default true);
    create table cron.job_run_details(runid bigint primary key, jobid bigint, status text,
      return_message text, start_time timestamptz, end_time timestamptz);
    insert into cron.job(jobname, schedule, command) values
      ('channel-compare-step', '* * * * *', 'select private.channel_compare_step()'),
      ('reconcile-video-comment-stats-step', '* 2-4 * * *', 'select private.video_stats_reconcile_step()');`);
});

afterAll(async () => {
  await db?.close();
});

describe("the comparison recount, one channel per run", () => {
  it("starts with every existing channel dirty and never counted", async () => {
    for (const c of [A1, A2, B1])
      expect(await unit(c)).toMatchObject({
        dirty: true,
        counted: false,
        attempts: 0,
      });
    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from private.video_stats_reconcile_units",
    );
    expect(n).toBe(2);
  });

  it("shows never-counted channels as such on the comparison page", async () => {
    await as(ADMIN);
    const { r } = await one<{ r: unknown }>(
      "select public.admin_channels_compare() as r",
    );
    await db.exec("reset role");
    const rows = AdminChannelsCompareSchema.parse(r);
    expect(rows.map((x) => x.count_state)).toEqual(["never", "never", "never"]);
    expect(rows.every((x) => x.refreshed_at === null)).toBe(true);
  });

  it("counts exactly one channel per step, then goes idle", async () => {
    expect(await step()).toBe("counted");
    const counted = await one<{ n: number }>(
      "select count(*)::int as n from private.channel_compare_units where refreshed_at is not null",
    );
    expect(counted.n).toBe(1);
    expect(await step()).toBe("counted");
    expect(await step()).toBe("counted");
    expect(await step()).toBe("idle");
    for (const c of [A1, A2, B1])
      expect(await unit(c)).toMatchObject({
        dirty: false,
        counted: true,
        attempts: 0,
      });
    const { analysed, positive } = await one<{
      analysed: number;
      positive: number;
    }>(
      `select sum(analysed)::int as analysed, sum(positive)::int as positive
         from private.channel_compare_cells where channel_id = $1`,
      [A1],
    );
    expect({ analysed, positive }).toEqual({ analysed: 3, positive: 2 });
  });

  it("turns a verdict's mark into dirty channels, counted after five quiet minutes", async () => {
    await db.query(
      `update sentiment_predictions set label = 'neutral'
        where workspace_id = $1 and content_hash = $2`,
      [A, `h-${A1}-1`],
    );
    expect(await step()).toBe("idle");
    expect(await unit(A1)).toMatchObject({ dirty: true, counted: true });
    expect(await unit(A2)).toMatchObject({ dirty: true });
    expect(await unit(B1)).toMatchObject({ dirty: false });
    await db.query(
      "update private.channel_compare_units set dirty_since = now() - interval '6 minutes' where workspace_id = $1",
      [A],
    );
    expect(await step()).toBe("counted");
    expect(await step()).toBe("counted");
    expect(await step()).toBe("idle");
    const { negative } = await one<{ negative: number }>(
      "select sum(negative)::int as negative from private.channel_compare_cells where channel_id = $1",
      [A1],
    );
    expect(negative).toBe(0);
  });

  it("charges a cancelled run to the unit it was counting, once, and backs it off", async () => {
    // B1 and A2 dirty; the order puts B1 first (older mark).
    await db.query(
      `update private.channel_compare_units set dirty_since = now() - interval '20 minutes' where channel_id = $1;
       `,
      [B1],
    );
    await db.query(
      "update private.channel_compare_units set dirty_since = now() - interval '10 minutes' where channel_id = $1",
      [A2],
    );
    await cronRun("channel-compare-step", "failed");
    expect(await step()).toBe("failure recorded");
    expect(await unit(B1)).toMatchObject({
      dirty: true,
      attempts: 1,
      last_error: "ERROR:  canceling statement due to statement timeout",
      backed_off: true,
    });
    expect(await unit(A2)).toMatchObject({ attempts: 0 });
    // The same failed run is not charged twice; the next unit is counted.
    expect(await step()).toBe("counted");
    expect(await unit(A2)).toMatchObject({ dirty: false, attempts: 0 });
    // B1 waits out its back-off.
    expect(await step()).toBe("idle");
  });

  it("shows the failing channel with its error on the comparison page", async () => {
    await as(ADMIN);
    const { r } = await one<{ r: unknown }>(
      "select public.admin_channels_compare() as r",
    );
    await db.exec("reset role");
    const rows = AdminChannelsCompareSchema.parse(r);
    const b = rows.find((x) => x.id === B1)!;
    expect(b.count_state).toBe("failing");
    expect(b.count_error).toBe(
      "ERROR:  canceling statement due to statement timeout",
    );
    expect(b.next_attempt_at).not.toBeNull();
    expect(rows.find((x) => x.id === A2)!.count_state).toBe("current");
  });

  it("clears the failure once the unit is counted again", async () => {
    await db.query(
      "update private.channel_compare_units set next_attempt_at = now() - interval '1 second' where channel_id = $1",
      [B1],
    );
    await cronRun("channel-compare-step", "succeeded");
    expect(await step()).toBe("counted");
    expect(await unit(B1)).toMatchObject({
      dirty: false,
      attempts: 0,
      last_error: null,
      backed_off: false,
    });
  });

  it("still lets a manual drain recount a whole workspace", async () => {
    await db.query(
      "insert into private.channel_compare_dirty(workspace_id) values ($1)",
      [A],
    );
    const { n } = await one<{ n: number }>(
      "select private.drain_channel_compare(15) as n",
    );
    expect(n).toBe(1);
    expect(await unit(A1)).toMatchObject({ dirty: false, counted: true });
  });
});

describe("the stats reconcile, one workspace per run", () => {
  it("reconciles each workspace once, then waits for the next day", async () => {
    expect(await reconcileStep()).toBe("reconciled");
    expect(await reconcileStep()).toBe("reconciled");
    expect(await reconcileStep()).toBe("idle");
    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from private.video_stats_reconcile_units where reconciled_at is not null",
    );
    expect(n).toBe(2);
  });

  it("charges a cancelled run to the workspace it was reconciling", async () => {
    await db.query(
      "update private.video_stats_reconcile_units set reconciled_at = now() - interval '21 hours'",
    );
    await cronRun("reconcile-video-comment-stats-step", "failed");
    expect(await reconcileStep()).toBe("failure recorded");
    const { attempts, last_error } = await one<{
      attempts: number;
      last_error: string;
    }>(
      "select attempts, last_error from private.video_stats_reconcile_units where workspace_id = $1",
      [A],
    );
    expect({ attempts, last_error }).toEqual({
      attempts: 1,
      last_error: "ERROR:  canceling statement due to statement timeout",
    });
    expect(await reconcileStep()).toBe("reconciled");
  });
});

describe("admin_background_jobs", () => {
  it("is refused to anyone but a platform admin", async () => {
    await as(OTHER);
    await expect(
      db.query("select public.admin_background_jobs()"),
    ).rejects.toThrow(/forbidden/);
    await db.exec("reset role");
    await db.exec("set role anon");
    await expect(
      db.query("select public.admin_background_jobs()"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("reports each job's last run, failures in 24 hours, and both unit tables", async () => {
    await as(ADMIN);
    const { r } = await one<{ r: Record<string, unknown> }>(
      "select public.admin_background_jobs() as r",
    );
    await db.exec("reset role");
    expect(r.cron_available).toBe(true);
    const jobs = r.jobs as {
      name: string;
      last_status: string;
      last_error: string | null;
      runs_24h: number;
      failures_24h: number;
    }[];
    const compare = jobs.find((j) => j.name === "channel-compare-step")!;
    expect(compare).toMatchObject({
      last_status: "succeeded",
      last_error: null,
      runs_24h: 2,
      failures_24h: 1,
    });
    const stats = jobs.find(
      (j) => j.name === "reconcile-video-comment-stats-step",
    )!;
    expect(stats).toMatchObject({
      last_status: "failed",
      last_error: "ERROR:  canceling statement due to statement timeout",
      failures_24h: 1,
    });
    expect(r.compare).toMatchObject({
      channels: 3,
      counted: 3,
      never_counted: 0,
      failing: 0,
    });
    expect(r.stats).toMatchObject({ workspaces: 2, failing: 1 });
  });

  it("carries its own statement timeout, as PostgREST applies it", async () => {
    const { config } = await one<{ config: string[] }>(
      `select p.proconfig as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_background_jobs'`,
    );
    expect(config).toContain("statement_timeout=30s");
  });
});
