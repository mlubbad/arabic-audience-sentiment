/**
 * `admin_channels_compare`: the owner console's comparison page, and the
 * counts kept ready for it (`private.channel_compare_cells`).
 *
 * A verdict marks its workspace; `drain_channel_compare` recounts marked
 * workspaces; the read gives one row per YouTube channel with the counts the
 * workspace dashboard would show: the channel's own comments left out, a
 * human review over the model, this week against the week before, and the
 * most discussed topic other than "other". Only a platform admin may read
 * it, and the counts are out of the browser's reach.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminChannelsCompareSchema,
  type AdminCompareChannel,
} from "@sentiment/contracts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const KEY = "sentiment-key";
const TOPICS = "topic-key";
const HOME = "00000000-0000-4000-8000-000000000001";
let db: PGlite;

type Channel = { workspace_id: string; channel_id: string; external: string };

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function compare(): Promise<AdminCompareChannel[]> {
  await as("authenticated", ADMIN);
  const { rows } = await db.query<{ r: unknown }>(
    "select public.admin_channels_compare() as r",
  );
  await db.exec("reset role");
  return AdminChannelsCompareSchema.parse(rows[0]!.r);
}

async function drain(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "select private.drain_channel_compare(15) as n",
  );
  return rows[0]!.n;
}

async function marked(workspace: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from private.channel_compare_dirty where workspace_id=$1",
    [workspace],
  );
  return rows[0]!.n;
}

/** One imported channel, with one video and an analysis run to judge by. */
async function imported(n: number, title: string): Promise<Channel> {
  await as("authenticated", ADMIN);
  const external = `UC${"B".repeat(20)}${String(n).padStart(2, "0")}`;
  const { rows } = await db.query<{
    r: { workspace_id: string; channel_id: string };
  }>("select public.admin_import_channel($1,$2) as r", [external, title]);
  await db.exec("reset role");
  return { ...rows[0]!.r, external };
}

let seq = 0;
/** One comment on the channel's video, judged when a label is given. */
async function comment(
  c: Channel,
  opts: {
    daysAgo?: number | null;
    label?: string;
    topic?: string;
    byOwner?: boolean;
  },
): Promise<{ id: string; hash: string }> {
  seq++;
  const { rows: v } = await db.query<{ id: string }>(
    `insert into videos(workspace_id, channel_id, external_video_id, title, comments_state)
     values ($1,$2,$3,$3,'open')
     on conflict (workspace_id, platform, external_video_id) do update set title = excluded.title
     returning id`,
    [c.workspace_id, c.channel_id, `vid-${c.external}`],
  );
  const hash = `hash-${seq}`;
  const days = opts.daysAgo === undefined ? 1 : opts.daysAgo;
  const { rows } = await db.query<{ id: string }>(
    `insert into comments(workspace_id, video_id, external_comment_id, text_raw, text_plain,
       content_hash, timestamp_precision, source, published_at, author_channel_id)
     values ($1,$2,$3,'t','t',$4,'second','test',
       case when $5::int is null then null else now() - make_interval(days => $5::int) end, $6)
     returning id`,
    [
      c.workspace_id,
      v[0]!.id,
      `c-${seq}`,
      hash,
      days,
      opts.byOwner ? c.external : `UCviewer${seq}`,
    ],
  );
  const id = rows[0]!.id;
  if (opts.label) {
    await db.query(
      `insert into analysis_runs(workspace_id, model_id, revision_sha, preprocessing_version, status)
       values ($1,'m','sha','v1','succeeded') on conflict do nothing`,
      [c.workspace_id],
    );
    const { rows: run } = await db.query<{ id: string }>(
      "select id from analysis_runs where workspace_id=$1",
      [c.workspace_id],
    );
    await db.query(
      `insert into sentiment_predictions(workspace_id, comment_id, content_hash, analysis_run_id,
         analysis_key, status, label)
       values ($1,$2,$3,$4,$5,'succeeded',$6)`,
      [c.workspace_id, id, hash, run[0]!.id, KEY, opts.label],
    );
  }
  if (opts.topic)
    await db.query(
      `insert into topic_predictions(workspace_id, comment_id, content_hash, classification_key,
         status, topic_key, confidence, model_id, prompt_version)
       values ($1,$2,$3,$4,'succeeded',$5,0.9,'tm','p1')`,
      [c.workspace_id, id, hash, TOPICS, opts.topic],
    );
  return { id, hash };
}

let loud: Channel;
let quiet: Channel;
let fresh: Channel;

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
  // The owner's plan, which imports count against.
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

  // Loud: this week 6 positive, 2 negative; the week before 1 positive,
  // 3 negative; a month back 2 neutral, and one comment with no date.
  loud = await imported(1, "Loud");
  for (let i = 0; i < 6; i++)
    await comment(loud, { daysAgo: 2, label: "positive", topic: "praise" });
  for (let i = 0; i < 2; i++)
    await comment(loud, { daysAgo: 3, label: "negative", topic: "other" });
  for (let i = 0; i < 3; i++)
    await comment(loud, { daysAgo: 9, label: "negative", topic: "other" });
  await comment(loud, { daysAgo: 10, label: "positive", topic: "other" });
  for (let i = 0; i < 2; i++)
    await comment(loud, { daysAgo: 30, label: "neutral" });
  await comment(loud, { daysAgo: null, label: "mixed" });
  // Not judged yet, and the channel answering its own audience.
  await comment(loud, { daysAgo: 1 });
  await comment(loud, { daysAgo: 1, label: "positive", byOwner: true });

  // Quiet: a customer's channel, one negative comment a reviewer turned
  // positive, and one whose text changed after the review.
  quiet = await imported(2, "Quiet");
  await db.query("update workspaces set created_by=$2 where id=$1", [
    quiet.workspace_id,
    OTHER,
  ]);
  const reviewed = await comment(quiet, { daysAgo: 1, label: "negative" });
  const stale = await comment(quiet, { daysAgo: 1, label: "negative" });
  await db.query(
    `insert into comment_reviews(workspace_id, comment_id, content_hash, label, reviewer_id, reason)
     values ($1,$2,$3,'positive',$4,'checked'), ($1,$5,'old-text','positive',$4,'checked')`,
    [quiet.workspace_id, reviewed.id, reviewed.hash, ADMIN, stale.id],
  );

  // Fresh: imported, nothing counted yet.
  fresh = await imported(3, "Fresh");
});

afterAll(async () => {
  await db?.close();
});

describe("the counts kept for the comparison page", () => {
  it("a verdict marks its workspace, and a drain recounts every marked one", async () => {
    expect(await marked(loud.workspace_id)).toBeGreaterThan(0);
    expect(await drain()).toBeGreaterThanOrEqual(2);
    expect(await marked(loud.workspace_id)).toBe(0);
    expect(await marked(quiet.workspace_id)).toBe(0);
  });

  it("ranks the audience as the dashboard counts it: own comments out, this week against the last", async () => {
    const row = (await compare()).find((r) => r.id === loud.channel_id)!;
    expect(row).toMatchObject({
      title: "Loud",
      mine: true,
      copies: 1,
      analysed: 15,
      positive: 7,
      negative: 5,
      neutral: 2,
      mixed: 1,
      week: { analysed: 8, positive: 6, negative: 2 },
      previous_week: { analysed: 4, positive: 1, negative: 3 },
    });
    // "other" is the most frequent but names nothing; praise is next.
    expect(row.top_topic).toMatchObject({ key: "praise", comments: 6 });
    expect(row.top_topic!.name_ar.length).toBeGreaterThan(0);
    expect(row.refreshed_at).not.toBeNull();
  });

  it("takes a human review over the model only for the text it judged", async () => {
    const row = (await compare()).find((r) => r.id === quiet.channel_id)!;
    expect(row).toMatchObject({
      mine: false,
      owner_email: "customer@example.com",
      positive: 1,
      negative: 1,
    });
  });

  it("lists a channel not counted yet with no numbers and no count time", async () => {
    const row = (await compare()).find((r) => r.id === fresh.channel_id)!;
    expect(row).toMatchObject({
      analysed: 0,
      top_topic: null,
    });
  });

  it("a new verdict is counted on the next drain", async () => {
    await comment(fresh, { daysAgo: 1, label: "negative" });
    expect(await marked(fresh.workspace_id)).toBeGreaterThan(0);
    await drain();
    const row = (await compare()).find((r) => r.id === fresh.channel_id)!;
    expect(row).toMatchObject({ analysed: 1, negative: 1 });
    expect(row.refreshed_at).not.toBeNull();
  });

  it("shows one YouTube channel once, through the copy with the most analysed comments", async () => {
    const { rows: ws } = await db.query<{ id: string }>(
      "insert into workspaces(name, created_by) values ('Copy', $1) returning id",
      [OTHER],
    );
    const copyWs = ws[0]!.id;
    await db.query(
      "insert into clients(id, workspace_id, name) values ($1,$1,'Copy')",
      [copyWs],
    );
    const { rows: ch } = await db.query<{ id: string }>(
      `insert into channels(workspace_id, client_id, external_channel_id, title)
       values ($1,$1,$2,'Loud copy') returning id`,
      [copyWs, loud.external],
    );
    const copy: Channel = {
      workspace_id: copyWs,
      channel_id: ch[0]!.id,
      external: loud.external,
    };
    await comment(copy, { daysAgo: 1, label: "negative" });
    await drain();
    const rows = (await compare()).filter((r) =>
      [loud.channel_id, copy.channel_id].includes(r.id),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: loud.channel_id, copies: 2 });
  });

  it("the nightly sweep marks every workspace with a channel", async () => {
    await db.query("select private.mark_all_channel_compare()");
    for (const c of [loud, quiet, fresh])
      expect(await marked(c.workspace_id)).toBe(1);
    await drain();
  });
});

describe("who may read it", () => {
  it("refuses everyone but a platform admin, and the counts are out of the browser's reach", async () => {
    await as("authenticated", OTHER);
    await expect(
      db.query("select public.admin_channels_compare()"),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select * from private.channel_compare_cells"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select private.drain_channel_compare(1)"),
    ).rejects.toThrow(/permission denied/);
    await as("anon", null);
    await expect(
      db.query("select public.admin_channels_compare()"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
