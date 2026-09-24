import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const W2 = "00000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000001";

let db: PGlite;
let channelId: string;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const resetAdmin = () => db.exec("reset role");

describe("interaction metrics and storytelling", () => {
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
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    }

    await db.query("insert into auth.users(id) values ($1)", [owner]);

    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Interaction WS',$2),($3,'Dedupe WS',$2)",
      [W, owner, W2],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$2,'workspace_owner')",
      [W, owner, W2],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'creator','active',now(),now()+'30 days'::interval),($2,'creator','active',now(),now()+'30 days'::interval)",
      [W, W2],
    );

    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Client 1'),($2,$2,'Client 2')",
      [W, W2],
    );

    // Register channel
    await user(owner);
    const regRes = await db.query<{ id: string }>(
      "select id from register_public_channel($1, $1, 'UC1234567890123456789012', '@arabictech', 'Arabic Tech Hub')",
      [W],
    );
    channelId = regRes.rows[0].id;

    // Update channel interaction stats
    await resetAdmin();
    await db.query(
      "update public.channels set subscriber_count = 150000, total_view_count = 2500000, video_count = 120, avatar_url = 'https://yt3.ggpht.com/avatar.jpg' where id = $1",
      [channelId],
    );

    // Register test worker credential
    await db.query(
      "insert into private.worker_credentials(token_hash, label, workspace_id) values ($1, 'test', null)",
      ["a".repeat(64)],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("persists video interaction metrics via worker_commit_catalogue", async () => {
    await resetAdmin();
    // Create a job lease
    const jobRes = await db.query<{ id: string; lease_token: string }>(
      "insert into public.jobs (workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at) values ($1, $2, 'discover', 'job_cat_1', 'running', gen_random_uuid(), now() + interval '5 minutes') returning id, lease_token",
      [W, channelId],
    );
    const job = jobRes.rows[0];

    const tokenHash = "a".repeat(64);

    const cataloguePayload = [
      {
        external_video_id: "dQw4w9WgXcQ",
        title: "Arabic AI Sentiment Tutorial",
        kind: "video",
        published_at: "2026-09-01T12:00:00Z",
        duration_sec: 720,
        thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        reported_comment_count: 50,
        comments_state: "open",
        view_count: 10000,
        like_count: 500,
        favorite_count: 10,
        tags: ["ai", "arabic", "sentiment"],
        description: "Comprehensive guide to Arabic NLP and sentiment analysis",
        category_id: "28",
      },
    ];

    const res = await db.query<{ worker_commit_catalogue: { videos: number } }>(
      "select private.worker_commit_catalogue($1, $2, $3, $4::jsonb) as worker_commit_catalogue",
      [tokenHash, job.id, job.lease_token, JSON.stringify(cataloguePayload)],
    );
    expect(res.rows[0].worker_commit_catalogue.videos).toBe(1);

    const vidCheck = await db.query<{
      id: string;
      view_count: string;
      like_count: string;
      thumbnail_url: string;
      tags: string[];
      description: string;
    }>(
      "select id, view_count, like_count, thumbnail_url, tags, description from public.videos where workspace_id = $1 and external_video_id = 'dQw4w9WgXcQ'",
      [W],
    );
    expect(vidCheck.rows.length).toBe(1);
    expect(vidCheck.rows[0].id).toBeDefined();
    expect(Number(vidCheck.rows[0].view_count)).toBe(10000);
    expect(Number(vidCheck.rows[0].like_count)).toBe(500);
    expect(vidCheck.rows[0].thumbnail_url).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(vidCheck.rows[0].tags).toEqual(["ai", "arabic", "sentiment"]);
    expect(vidCheck.rows[0].description).toBe(
      "Comprehensive guide to Arabic NLP and sentiment analysis",
    );
  });

  it("persists comment interaction metrics via commit_batch", async () => {
    await resetAdmin();
    const jobRes = await db.query<{ id: string; lease_token: string }>(
      "insert into public.jobs (workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at) values ($1, $2, 'collect', 'job_col_1', 'running', gen_random_uuid(), now() + interval '5 minutes') returning id, lease_token",
      [W, channelId],
    );
    const job = jobRes.rows[0];

    const batchPayload = {
      external_video_id: "dQw4w9WgXcQ",
      video_title: "Arabic AI Sentiment Tutorial",
      outcome: "exhausted",
      comments: [
        {
          external_comment_id: "comm_001",
          author_name: "أحمد المطور",
          author_channel_id: "UC_AHMED",
          author_profile_image_url: "https://yt3.ggpht.com/ahmed.jpg",
          author_channel_url: "https://youtube.com/@ahmed_dev",
          reply_count: 5,
          text_raw: "شرح ممتاز جداً ومفيد للغاية بارك الله فيك",
          text_plain: "شرح ممتاز جدا ومفيد للغاية بارك الله فيك",
          content_hash:
            "hash001001001001001001001001001001001001001001001001001001001001",
          published_at: "2026-09-02T10:00:00Z",
          published_time_raw: "2026-09-02T10:00:00Z",
          timestamp_precision: "second",
          likes_value: 45,
          likes_raw: "45",
          is_reply: false,
          updated_at: "2026-09-02T11:00:00Z",
          source: "youtube_data_api_public",
        },
        {
          external_comment_id: "comm_002",
          author_name: "سارة التقنية",
          author_channel_id: "UC_SARA",
          author_profile_image_url: "https://yt3.ggpht.com/sara.jpg",
          author_channel_url: "https://youtube.com/@sara_tech",
          reply_count: 2,
          text_raw: "الصوت فيه تشويش خفيف في بعض المقاطع",
          text_plain: "الصوت فيه تشويش خفيف في بعض المقاطع",
          content_hash:
            "hash002002002002002002002002002002002002002002002002002002002002",
          published_at: "2026-09-02T10:30:00Z",
          published_time_raw: "2026-09-02T10:30:00Z",
          timestamp_precision: "second",
          likes_value: 12,
          likes_raw: "12",
          is_reply: false,
          updated_at: null,
          source: "youtube_data_api_public",
        },
      ],
      predictions: [
        {
          external_comment_id: "comm_001",
          analysis_key: "camelbert-da-sentiment",
          model_id: "aubmindlab/bert-base-arabertv02",
          revision: "rev1",
          preprocessing_version: "1.0",
          content_hash:
            "hash001001001001001001001001001001001001001001001001001001001001",
          status: "succeeded",
          label: "positive",
          confidence: 0.98,
          class_scores: { positive: 0.98, negative: 0.01, neutral: 0.01 },
          predicted_at: "2026-09-02T10:05:00Z",
        },
        {
          external_comment_id: "comm_002",
          analysis_key: "camelbert-da-sentiment",
          model_id: "aubmindlab/bert-base-arabertv02",
          revision: "rev1",
          preprocessing_version: "1.0",
          content_hash:
            "hash002002002002002002002002002002002002002002002002002002002002",
          status: "succeeded",
          label: "negative",
          confidence: 0.85,
          class_scores: { positive: 0.05, negative: 0.85, neutral: 0.1 },
          predicted_at: "2026-09-02T10:35:00Z",
        },
      ],
    };

    const batchHash = "a".repeat(64);
    await db.query(
      "select private.commit_batch($1, $2, 'batch_001', $3, $4::jsonb)",
      [job.id, job.lease_token, batchHash, JSON.stringify(batchPayload)],
    );

    // Verify comments table columns
    const commRows = await db.query<{
      external_comment_id: string;
      author_profile_image_url: string;
      author_channel_url: string;
      reply_count: number;
    }>(
      "select external_comment_id, author_profile_image_url, author_channel_url, reply_count from public.comments where workspace_id = $1 order by external_comment_id",
      [W],
    );
    expect(commRows.rows.length).toBe(2);
    expect(commRows.rows[0].author_profile_image_url).toBe(
      "https://yt3.ggpht.com/ahmed.jpg",
    );
    expect(commRows.rows[0].author_channel_url).toBe(
      "https://youtube.com/@ahmed_dev",
    );
    expect(commRows.rows[0].reply_count).toBe(5);
    expect(commRows.rows[1].author_profile_image_url).toBe(
      "https://yt3.ggpht.com/sara.jpg",
    );
    expect(commRows.rows[1].reply_count).toBe(2);
  });

  it("exposes storytelling KPIs, enriched videos, and people avatars in dashboard_aggregates_impl", async () => {
    await user(owner);
    interface AggData {
      kpis: {
        total_views: number;
        total_likes: number;
        total_comments: number;
        engagement_rate: number;
        net_sentiment: number;
      };
      channel: {
        subscriber_count: number;
        avatar_url: string;
      };
      videos: Array<{
        thumbnail_url: string;
        view_count: number;
        like_count: number;
      }>;
      people: Array<{
        name: string;
        avatar_url: string;
        channel_url: string;
        likes_count: number;
      }>;
    }
    const aggRes = await db.query<{ dashboard_aggregates_impl: AggData }>(
      "select private.dashboard_aggregates_impl($1, '{}'::jsonb) as dashboard_aggregates_impl",
      [W],
    );
    const agg = aggRes.rows[0].dashboard_aggregates_impl;

    // Check KPIs
    expect(agg.kpis).toBeDefined();
    expect(agg.kpis.total_views).toBe(10000);
    expect(agg.kpis.total_likes).toBe(500);
    expect(agg.kpis.total_comments).toBe(2);
    // engagement_rate: ((500 + 2) / 10000) * 100 = 5.02%
    expect(Number(agg.kpis.engagement_rate)).toBeCloseTo(5.02, 1);
    // net_sentiment: ((1 - 1) / (1 + 1)) * 100 = 0%
    expect(Number(agg.kpis.net_sentiment)).toBe(0);

    // Check channel enrichment
    expect(agg.channel).toBeDefined();
    expect(agg.channel.subscriber_count).toBe(150000);
    expect(agg.channel.avatar_url).toBe("https://yt3.ggpht.com/avatar.jpg");

    // Check video enrichment
    expect(agg.videos).toBeDefined();
    expect(agg.videos.length).toBe(1);
    expect(agg.videos[0].thumbnail_url).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(Number(agg.videos[0].view_count)).toBe(10000);
    expect(Number(agg.videos[0].like_count)).toBe(500);

    // Check people enrichment
    expect(agg.people).toBeDefined();
    expect(agg.people.length).toBeGreaterThanOrEqual(2);
    const ahmed = agg.people.find((p) => p.name === "أحمد المطور");
    expect(ahmed).toBeDefined();
    expect(ahmed?.avatar_url).toBe("https://yt3.ggpht.com/ahmed.jpg");
    expect(ahmed?.channel_url).toBe("https://youtube.com/@ahmed_dev");
    expect(ahmed?.likes_count).toBe(45);
  });

  it("exposes author avatars and reply counts in dashboard_comments_impl", async () => {
    await user(owner);
    interface CommentsData {
      total: number;
      comments: Array<{
        author_name: string;
        author_profile_image_url: string;
        author_channel_url: string;
        reply_count: number;
        updated_at: string;
      }>;
    }
    const commRes = await db.query<{ dashboard_comments_impl: CommentsData }>(
      "select private.dashboard_comments_impl($1, '{\"limit\": 10}'::jsonb) as dashboard_comments_impl",
      [W],
    );
    const commentsData = commRes.rows[0].dashboard_comments_impl;
    expect(commentsData.total).toBe(2);
    expect(commentsData.comments.length).toBe(2);

    const first = commentsData.comments.find(
      (c) => c.author_name === "أحمد المطور",
    );
    expect(first).toBeDefined();
    expect(first?.author_profile_image_url).toBe(
      "https://yt3.ggpht.com/ahmed.jpg",
    );
    expect(first?.author_channel_url).toBe("https://youtube.com/@ahmed_dev");
    expect(first?.reply_count).toBe(5);
    expect(first?.updated_at).toBeDefined();
  });

  it("copies interaction metrics during cross-workspace deduplication adoption", async () => {
    await resetAdmin();
    // Insert same channel in W2
    const ch2Res = await db.query<{ id: string }>(
      "insert into public.channels(workspace_id, client_id, external_channel_id, handle, title, platform, status) values ($1, $1, 'UC1234567890123456789012', '@arabictech', 'Arabic Tech Hub', 'youtube', 'connected') returning id",
      [W2],
    );
    const ch2Id = ch2Res.rows[0].id;

    // Trigger adoption
    await resetAdmin();
    interface AdoptResult {
      videos: number;
      comments: number;
    }
    const adoptRes = await db.query<{ adopt_channel_content: AdoptResult }>(
      "select private.adopt_channel_content($1, $2) as adopt_channel_content",
      [W2, ch2Id],
    );
    expect(adoptRes.rows[0].adopt_channel_content.videos).toBe(1);
    expect(adoptRes.rows[0].adopt_channel_content.comments).toBe(2);

    // Verify interaction metrics were copied to W2
    const w2Videos = await db.query<{
      view_count: string;
      like_count: string;
      thumbnail_url: string;
    }>(
      "select view_count, like_count, thumbnail_url from public.videos where workspace_id = $1",
      [W2],
    );
    expect(Number(w2Videos.rows[0].view_count)).toBe(10000);
    expect(Number(w2Videos.rows[0].like_count)).toBe(500);

    const w2Comments = await db.query<{
      author_profile_image_url: string;
      reply_count: number;
    }>(
      "select author_profile_image_url, reply_count from public.comments where workspace_id = $1 and author_name = 'أحمد المطور'",
      [W2],
    );
    expect(w2Comments.rows[0].author_profile_image_url).toBe(
      "https://yt3.ggpht.com/ahmed.jpg",
    );
    expect(w2Comments.rows[0].reply_count).toBe(5);
  });

  it("handles workspaces with no registered channel without crashing or returning invalid payloads", async () => {
    const W_NO_CHANNEL = "00000000-0000-4000-8000-000000000099";
    await resetAdmin();
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Empty WS',$2)",
      [W_NO_CHANNEL, owner],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W_NO_CHANNEL,
      owner,
    ]);

    await user(owner);
    const aggRes = await db.query<{
      dashboard_aggregates: Record<string, unknown>;
    }>("select dashboard_aggregates($1, '{}'::jsonb) as dashboard_aggregates", [
      W_NO_CHANNEL,
    ]);
    const agg = aggRes.rows[0].dashboard_aggregates;
    expect(agg.channel).toBeNull();
    expect(agg.total).toBe(0);
    expect(agg.workspace_total).toBe(0);

    const commentsRes = await db.query<{
      dashboard_comments: { total: number; comments: unknown[] };
    }>("select dashboard_comments($1, '{}'::jsonb) as dashboard_comments", [
      W_NO_CHANNEL,
    ]);
    const comments = commentsRes.rows[0].dashboard_comments;
    expect(comments.total).toBe(0);
    expect(comments.comments).toEqual([]);
  });
});
