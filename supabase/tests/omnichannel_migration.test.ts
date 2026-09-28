/**
 * Tests for 20260920190000_omnichannel_multi_platform_support.sql
 * Verifies multi-platform constraints, indexes, register_public_channel platform argument,
 * and platform filtering in dashboard_aggregates and dashboard_comments.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const YT_ID = "UCTPIL6f7yNpK8yc-H3cEtFg";
const TG_ID = "@aljazeera_channel";
let db: PGlite;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const admin = () => db.exec("reset role");

describe("omnichannel multi-platform migration", () => {
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
    await db.query("insert into auth.users(id) values ($1)", [ownerA]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Workspace A',$2)",
      [A, ownerA],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      A,
      ownerA,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Client A')",
      [A],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'owner','active',now(),now()+interval '30 days')",
      [A],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("permits registered platforms and refuses unsupported platform", async () => {
    await admin();
    // Valid platform insertion
    await expect(
      db.query(
        "insert into channels(workspace_id,client_id,platform,external_channel_id) values ($1,$1,'telegram','tg_12345')",
        [A],
      ),
    ).resolves.toBeDefined();

    // Invalid platform insertion
    await expect(
      db.query(
        "insert into channels(workspace_id,client_id,platform,external_channel_id) values ($1,$1,'unsupported_plat','bad_12345')",
        [A],
      ),
    ).rejects.toThrow(/channels_platform_check/);
  });

  it("permits multi-platform content kinds in videos", async () => {
    await admin();
    const ch = (
      await db.query<{ id: string }>(
        "select id from channels where workspace_id = $1 limit 1",
        [A],
      )
    ).rows[0];

    // channel_post
    await expect(
      db.query(
        "insert into videos(workspace_id,channel_id,platform,external_video_id,title,kind) values ($1,$2,'telegram','msg_101','Telegram Post 101','channel_post')",
        [A, ch.id],
      ),
    ).resolves.toBeDefined();

    // tweet
    await expect(
      db.query(
        "insert into videos(workspace_id,channel_id,platform,external_video_id,title,kind) values ($1,$2,'x','tweet_999','Tweet 999','tweet')",
        [A, ch.id],
      ),
    ).resolves.toBeDefined();

    // invalid kind
    await expect(
      db.query(
        "insert into videos(workspace_id,channel_id,platform,external_video_id,title,kind) values ($1,$2,'youtube','invalid_vid','Title','invalid_kind')",
        [A, ch.id],
      ),
    ).rejects.toThrow(/videos_kind_check/);
  });

  it("registers public channels for youtube (default) and telegram with validation", async () => {
    await user(ownerA);

    // YouTube channel registration (5 arguments, default platform)
    const ytCh = await db.query<{
      id: string;
      platform: string;
      external_channel_id: string;
    }>(
      "select * from register_public_channel($1,$1,$2,'@yt_test','YouTube Channel Title')",
      [A, YT_ID],
    );
    expect(ytCh.rows[0].platform).toBe("youtube");
    expect(ytCh.rows[0].external_channel_id).toBe(YT_ID);

    // Telegram channel registration (6 arguments, explicit telegram platform)
    const tgCh = await db.query<{
      id: string;
      platform: string;
      external_channel_id: string;
    }>(
      "select * from register_public_channel($1,$1,$2,'@aljazeera_channel','Al Jazeera Telegram','telegram')",
      [A, TG_ID],
    );
    expect(tgCh.rows[0].platform).toBe("telegram");
    expect(tgCh.rows[0].external_channel_id).toBe(TG_ID);

    // Rejection on invalid telegram format
    await expect(
      db.query(
        "select * from register_public_channel($1,$1,'invalid channel with spaces!','handle','title','telegram')",
        [A],
      ),
    ).rejects.toThrow(/invalid_channel_id/);
  });

  it("filters dashboard aggregates and paginated comments by platform", async () => {
    await admin();
    const ytCh = (
      await db.query<{ id: string }>(
        "select id from channels where workspace_id = $1 and platform = 'youtube' limit 1",
        [A],
      )
    ).rows[0];
    const tgCh = (
      await db.query<{ id: string }>(
        "select id from channels where workspace_id = $1 and platform = 'telegram' limit 1",
        [A],
      )
    ).rows[0];

    // Seed YouTube video and comment
    const ytVid = (
      await db.query<{ id: string }>(
        "insert into videos(workspace_id,channel_id,platform,external_video_id,title,kind) values ($1,$2,'youtube','yt_vid_1','YT Vid','video') returning id",
        [A, ytCh.id],
      )
    ).rows[0];
    await db.query(
      `insert into comments(workspace_id,video_id,platform,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$2,'youtube','yt_c_1','تعليق رائع على يوتيوب','تعليق رائع على يوتيوب','hash_yt_1','second','api')`,
      [A, ytVid.id],
    );

    // Seed Telegram message and comment
    const tgVid = (
      await db.query<{ id: string }>(
        "insert into videos(workspace_id,channel_id,platform,external_video_id,title,kind) values ($1,$2,'telegram','tg_msg_1','TG Msg','channel_post') returning id",
        [A, tgCh.id],
      )
    ).rows[0];
    await db.query(
      `insert into comments(workspace_id,video_id,platform,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$2,'telegram','tg_c_1','تعليق نقاشي في تليجرام','تعليق نقاشي في تليجرام','hash_tg_1','second','api')`,
      [A, tgVid.id],
    );

    // Call dashboard_aggregates without platform filter -> sees both
    const aggAll = await db.query<{
      dashboard_aggregates: {
        total: number;
        platform_breakdown: Record<string, number>;
      };
    }>("select dashboard_aggregates($1, '{}'::jsonb)", [A]);
    const aggAllRes = aggAll.rows[0].dashboard_aggregates;
    expect(aggAllRes.total).toBe(2);
    expect(aggAllRes.platform_breakdown).toEqual({ youtube: 1, telegram: 1 });

    // Call dashboard_aggregates with platform: 'telegram' -> sees 1
    const aggTg = await db.query<{
      dashboard_aggregates: {
        total: number;
        platform_breakdown: Record<string, number>;
      };
    }>('select dashboard_aggregates($1, \'{"platform":"telegram"}\'::jsonb)', [
      A,
    ]);
    const aggTgRes = aggTg.rows[0].dashboard_aggregates;
    expect(aggTgRes.total).toBe(1);
    expect(aggTgRes.platform_breakdown).toEqual({ telegram: 1 });

    // Call dashboard_comments with platform: 'telegram' -> sees only telegram comment and has platform field
    const commTg = await db.query<{
      dashboard_comments: {
        total: number;
        comments: Array<{ platform: string; text_raw: string }>;
      };
    }>('select dashboard_comments($1, \'{"platform":"telegram"}\'::jsonb)', [
      A,
    ]);
    const commTgRes = commTg.rows[0].dashboard_comments;
    expect(commTgRes.total).toBe(1);
    expect(commTgRes.comments[0].platform).toBe("telegram");
    expect(commTgRes.comments[0].text_raw).toBe("تعليق نقاشي في تليجرام");
  });

  it("ingests batch into telegram platform correctly via commit_batch", async () => {
    await admin();
    const tgCh = (
      await db.query<{ id: string }>(
        "select id from channels where workspace_id = $1 and platform = 'telegram' limit 1",
        [A],
      )
    ).rows[0];

    const tgJobId = "50000000-0000-4000-8000-000000000001";
    const leaseToken = "60000000-0000-4000-8000-000000000001";

    // Setup active subscription for A
    await db.query(
      `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end)
       values ($1, 'pilot', 'active', now() - interval '1 day', now() + interval '29 days')
       on conflict (workspace_id) do update set status = 'active'`,
      [A],
    );

    // Insert running job for Telegram channel
    await db.query(
      `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at)
       values ($1, $2, $3, 'collect', 'dedupe-tg-1', 'running', $4, now() + interval '1 hour')`,
      [tgJobId, A, tgCh.id, leaseToken],
    );

    const tgBatchPayload = {
      external_video_id: "tg_post_42",
      video_title: "منشور تليجرام مهم",
      checkpoint: { offset: 10 },
      outcome: "exhausted",
      comments: [
        {
          external_comment_id: "tg_msg_reply_1",
          external_parent_id: null,
          is_reply: false,
          parent_source: "api",
          author_channel_id: "tg_user_1",
          author_name: "متابع تليجرام",
          text_raw: "محتوى عربي قيم ومفيد جداً",
          text_plain: "محتوى عربي قيم ومفيد جدا",
          content_hash: "hash_tg_msg_reply_1",
          published_time_raw: "2026-09-20T12:00:00Z",
          published_at: "2026-09-20T12:00:00Z",
          timestamp_precision: "second",
          likes_raw: "10",
          likes_value: 10,
          source: "telegram_mtproto",
          field_provenance: { source: "telegram" },
        },
      ],
      predictions: [
        {
          external_comment_id: "tg_msg_reply_1",
          content_hash: "hash_tg_msg_reply_1",
          analysis_key: "m@rev+v1",
          status: "succeeded",
          label: "positive",
          class_scores: { positive: 0.95 },
          model_id: "m",
          revision: "rev",
          preprocessing_version: "v1",
          parameters: { max_length: 256 },
        },
      ],
    };

    const res = await db.query<{ result: Record<string, unknown> }>(
      "select private.commit_batch($1, $2, 'batch_tg_1', $3, $4) as result",
      [tgJobId, leaseToken, "a".repeat(64), JSON.stringify(tgBatchPayload)],
    );
    expect(res.rows[0].result).toBeDefined();

    // Verify video row in db has platform = 'telegram' and kind = 'channel_post'
    const vidRow = (
      await db.query<{ platform: string; kind: string; title: string }>(
        "select platform, kind, title from videos where workspace_id = $1 and external_video_id = 'tg_post_42'",
        [A],
      )
    ).rows[0];
    expect(vidRow.platform).toBe("telegram");
    expect(vidRow.kind).toBe("channel_post");
    expect(vidRow.title).toBe("منشور تليجرام مهم");

    // Verify comment row in db has platform = 'telegram'
    const commentRow = (
      await db.query<{ platform: string; external_comment_id: string }>(
        "select platform, external_comment_id from comments where workspace_id = $1 and external_comment_id = 'tg_msg_reply_1'",
        [A],
      )
    ).rows[0];
    expect(commentRow.platform).toBe("telegram");
  });
});
