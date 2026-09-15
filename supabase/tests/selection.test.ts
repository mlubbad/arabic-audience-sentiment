/**
 * Selection is a table the tenant reads and never writes directly; what the
 * worker collects is computed from it on the server.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000001";
const OUTSIDER = "10000000-0000-4000-8000-000000000002";
const V1 = "20000000-0000-4000-8000-000000000001";
const V2 = "20000000-0000-4000-8000-000000000002";
const V3 = "20000000-0000-4000-8000-000000000003";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

describe("video selections", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    // Everything up to (not including) this task's migration, so the backfill
    // it carries runs over rows that exist before it.
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const cut = files.indexOf("20260915130000_video_catalogue_and_selections.sql");
    for (const f of files.slice(0, cut))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    for (const [w, owner, external] of [
      [W, OWNER, `UC${"a".repeat(22)}`],
      [OTHER, OUTSIDER, `UC${"b".repeat(22)}`],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [w, owner]);
      await db.query("insert into memberships values ($1,$2,'workspace_owner')", [w, owner]);
      await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [w]);
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, external],
      );
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'pilot','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
    }
    // A video that already has a comment (collected before this work), one
    // that does not, and one in the other tenant.
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title)
       values ($1,$4,$4,'aaaaaaaaaaa','قديم'),($2,$4,$4,'bbbbbbbbbbb','جديد'),($3,$5,$5,'ccccccccccc','غريب')`,
      [V1, V2, V3, W, OTHER],
    );
    await db.query(
      `insert into comments(workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$2,'c1','نص','نص','h1','second','test')`,
      [W, V1],
    );
    await db.exec(readFileSync("supabase/migrations/20260915130000_video_catalogue_and_selections.sql", "utf8"));
    for (const f of files.slice(cut + 1))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("backfills a live selection for every video that already has comments", async () => {
    await db.exec("reset role");
    const rows = await db.query<{ video_id: string; last_outcome: string | null }>(
      "select video_id, last_outcome from video_selections where workspace_id=$1 order by video_id",
      [W],
    );
    expect(rows.rows.map((r) => r.video_id)).toEqual([V1]);
    const state = await db.query<{ comments_state: string }>(
      "select comments_state from videos where id=$1",
      [V1],
    );
    expect(state.rows[0].comments_state).toBe("open");
    const fresh = await db.query<{ comments_state: string; reported_comment_count: number | null }>(
      "select comments_state, reported_comment_count from videos where id=$1",
      [V2],
    );
    expect(fresh.rows[0]).toEqual({ comments_state: "unknown", reported_comment_count: null });
  });

  it("lets a member read their selections and nobody else's", async () => {
    await as(OWNER);
    const mine = await db.query("select video_id from video_selections");
    expect(mine.rows).toHaveLength(1);
    await as(OUTSIDER);
    const theirs = await db.query("select video_id from video_selections");
    expect(theirs.rows).toHaveLength(0);
  });

  it("refuses a direct tenant write", async () => {
    await as(OWNER);
    await expect(
      db.query(
        "insert into video_selections(workspace_id,channel_id,video_id) values ($1,$1,$2)",
        [W, V2],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("answers the new plan intervals and keeps the old ones", async () => {
    await db.exec("reset role");
    const live = await db.query<{ v: number }>(
      "select private.plan_limit($1,'live_interval') as v",
      [W],
    );
    expect(live.rows[0].v).toBe(1440);
    const gap = await db.query<{ v: number }>(
      "select private.plan_limit($1,'sync_interval') as v",
      [W],
    );
    expect(gap.rows[0].v).toBe(0);
  });

  it("lists due videos oldest-due first and leaves out disabled ones", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into video_selections(workspace_id,channel_id,video_id,next_check_at)
       values ($1,$1,$2,now()-interval '2 hours')`,
      [W, V2],
    );
    await db.query("update video_selections set next_check_at=now()-interval '1 hour' where video_id=$1", [V1]);
    const due = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(due.rows[0].d.map((v) => v.video_id)).toEqual([V2, V1]);
    await db.query("update videos set comments_state='disabled' where id=$1", [V2]);
    const again = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(again.rows[0].d.map((v) => v.video_id)).toEqual([V1]);
    await db.query("update video_selections set next_check_at=now()+interval '1 day' where video_id=$1", [V1]);
    const none = await db.query<{ d: unknown[] }>("select private.due_videos($1,$1) as d", [W]);
    expect(none.rows[0].d).toEqual([]);
    // restore for later tasks
    await db.query("update videos set comments_state='unknown' where id=$1", [V2]);
    await db.query("delete from video_selections where video_id=$1", [V2]);
  });

  it("admits one outstanding discover per channel", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d1')",
      [W],
    );
    await expect(
      db.query(
        "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d2')",
        [W],
      ),
    ).rejects.toThrow(/jobs_one_outstanding_discover/);
    await db.query("update jobs set status='succeeded' where dedupe_key='d1'");
  });
});
