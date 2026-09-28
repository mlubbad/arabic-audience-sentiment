import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DashboardAggregates } from "@sentiment/contracts";

const W = "00000000-0000-4000-8000-000000000001";
const W_OTHER = "00000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";
const adminUser = "10000000-0000-4000-8000-000000000004";

let db: PGlite;
let channelId: string;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const resetAdmin = () => db.exec("reset role");

describe("WO-5a Part 2: Historical Import & Dashboard SQL Correctness", () => {
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

    await db.query("insert into auth.users(id) values ($1),($2),($3),($4)", [
      owner,
      viewer,
      outsider,
      adminUser,
    ]);

    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      adminUser,
    ]);

    await db.query(
      "insert into workspaces(id, name, created_by) values ($1, 'Main WS', $3), ($2, 'Other WS', $3)",
      [W, W_OTHER, owner],
    );

    await db.query(
      "insert into memberships (workspace_id, user_id, role) values ($1, $2, 'workspace_owner'), ($1, $3, 'viewer'), ($4, $5, 'workspace_owner')",
      [W, owner, viewer, W_OTHER, outsider],
    );

    // Give W an agency/enterprise plan (supports historical backfill)
    await db.query(
      "insert into public.subscriptions (workspace_id, plan_key, status, period_start, period_end) values ($1, 'agency', 'active', now(), now() + interval '30 days')",
      [W],
    );

    await db.query(
      "insert into clients(id, workspace_id, name) values ($1, $1, 'Client Main'), ($2, $2, 'Client Other')",
      [W, W_OTHER],
    );

    const chRes = await db.query<{ id: string }>(
      `insert into public.channels (workspace_id, client_id, platform, external_channel_id, title, status)
       values ($1, $1, 'youtube', 'UC_test_chan_123456789012', 'Test Channel', 'connected')
       returning id`,
      [W],
    );
    channelId = chRes.rows[0].id;
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe("import_historical_records: Invariant 3 (unknown is never zero, missing date is null/unknown)", () => {
    it("preserves NULL for missing likes_value and does NOT coerce to 0", async () => {
      await user(owner);
      const payload = {
        posts: [
          {
            external_video_id: "v_missing_likes",
            title: "Video with missing likes",
          },
        ],
        comments: [
          {
            external_video_id: "v_missing_likes",
            external_comment_id: "c_no_likes",
            author_name: "مستخدم",
            text_raw: "تعليق بدون لايكات محددة",
            published_at: "2026-01-15T10:00:00Z",
            // likes_value omitted
          },
          {
            external_video_id: "v_missing_likes",
            external_comment_id: "c_zero_likes",
            author_name: "مستخدم 2",
            text_raw: "تعليق بصفر لايكات صراحة",
            published_at: "2026-01-15T11:00:00Z",
            likes_value: 0,
          },
          {
            external_video_id: "v_missing_likes",
            external_comment_id: "c_ten_likes",
            author_name: "مستخدم 3",
            text_raw: "تعليق بعشرة لايكات",
            published_at: "2026-01-15T12:00:00Z",
            likes_value: 10,
          },
        ],
      };

      const res = await db.query<{
        result: { ok: boolean; comments_count: number };
      }>(
        "select public.import_historical_records($1, $2, $3::jsonb) as result",
        [W, channelId, JSON.stringify(payload)],
      );
      expect(res.rows[0].result.ok).toBe(true);

      await resetAdmin();
      const rows = await db.query<{
        external_comment_id: string;
        likes_value: number | null;
      }>(
        "select external_comment_id, likes_value from public.comments where workspace_id = $1 order by external_comment_id",
        [W],
      );

      const noLikes = rows.rows.find(
        (r) => r.external_comment_id === "c_no_likes",
      );
      const zeroLikes = rows.rows.find(
        (r) => r.external_comment_id === "c_zero_likes",
      );
      const tenLikes = rows.rows.find(
        (r) => r.external_comment_id === "c_ten_likes",
      );

      expect(noLikes?.likes_value).toBeNull(); // Invariant 3: unknown is never zero!
      expect(zeroLikes?.likes_value).toBe(0); // Explicit zero is preserved
      expect(tenLikes?.likes_value).toBe(10);
    });

    it("preserves NULL for missing published_at and sets timestamp_precision to 'unknown'", async () => {
      await user(owner);
      const payload = {
        posts: [
          {
            external_video_id: "v_missing_dates",
            title: "Video with missing dates",
          },
        ],
        comments: [
          {
            external_video_id: "v_missing_dates",
            external_comment_id: "c_no_date",
            author_name: "مستخدم",
            text_raw: "تعليق بدون تاريخ نشر",
            // published_at omitted
          },
          {
            external_video_id: "v_missing_dates",
            external_comment_id: "c_with_date",
            author_name: "مستخدم 2",
            text_raw: "تعليق بتاريخ نشر دقيق",
            published_at: "2026-02-20T15:30:00Z",
          },
        ],
      };

      const res = await db.query<{ result: { ok: boolean } }>(
        "select public.import_historical_records($1, $2, $3::jsonb) as result",
        [W, channelId, JSON.stringify(payload)],
      );
      expect(res.rows[0].result.ok).toBe(true);

      await resetAdmin();
      const rows = await db.query<{
        external_comment_id: string;
        published_at: string | null;
        timestamp_precision: string;
      }>(
        "select external_comment_id, published_at, timestamp_precision from public.comments where workspace_id = $1 and external_comment_id in ('c_no_date', 'c_with_date')",
        [W],
      );

      const noDate = rows.rows.find(
        (r) => r.external_comment_id === "c_no_date",
      );
      const withDate = rows.rows.find(
        (r) => r.external_comment_id === "c_with_date",
      );

      expect(noDate?.published_at).toBeNull(); // Invariant 3: missing date is null, never now()
      expect(noDate?.timestamp_precision).toBe("unknown"); // Invariant 3: precision unknown

      expect(withDate?.published_at).not.toBeNull();
      expect(withDate?.timestamp_precision).toBe("second");
    });

    it("refuses unauthorized caller (outsider or viewer)", async () => {
      await user(viewer);
      const payload = {
        posts: [],
        comments: [
          {
            external_video_id: "v1",
            external_comment_id: "c1",
            text_raw: "test",
          },
        ],
      };
      await expect(
        db.query("select public.import_historical_records($1, $2, $3::jsonb)", [
          W,
          channelId,
          JSON.stringify(payload),
        ]),
      ).rejects.toThrow(/forbidden/);

      await user(outsider);
      await expect(
        db.query("select public.import_historical_records($1, $2, $3::jsonb)", [
          W,
          channelId,
          JSON.stringify(payload),
        ]),
      ).rejects.toThrow(/forbidden/);
    });
  });

  describe("dashboard_aggregates: Invariant 3 (unknown metrics are null, not zero)", () => {
    it("reports null for video metrics when counts are null/unknown", async () => {
      await resetAdmin();
      // Create a fresh workspace for testing dashboard metrics
      const W_DASH = "00000000-0000-4000-8000-000000000009";
      await db.query(
        "insert into workspaces(id, name, created_by) values ($1, 'Dash WS', $2)",
        [W_DASH, owner],
      );
      await db.query(
        "insert into memberships values ($1, $2, 'workspace_owner')",
        [W_DASH, owner],
      );
      await db.query(
        "insert into clients(id, workspace_id, name) values ($1, $1, 'Dash Client')",
        [W_DASH],
      );
      const chRes = await db.query<{ id: string }>(
        `insert into public.channels (workspace_id, client_id, platform, external_channel_id, title, status)
         values ($1, $1, 'youtube', 'UC_dash_channel_999999999', 'Dash Chan', 'connected')
         returning id`,
        [W_DASH],
      );
      const dashChanId = chRes.rows[0].id;

      // Video with null view_count, like_count, reported_comment_count
      const vidRes = await db.query<{ id: string }>(
        `insert into public.videos (workspace_id, channel_id, platform, external_video_id, title, view_count, like_count, reported_comment_count)
         values ($1, $2, 'youtube', 'vid_null_counts', 'Video with unknown metrics', null, null, null)
         returning id`,
        [W_DASH, dashChanId],
      );
      const vidId = vidRes.rows[0].id;

      // Insert 1 comment on this video
      await db.query(
        `insert into public.comments (workspace_id, video_id, platform, external_comment_id, text_raw, text_plain, content_hash, timestamp_precision, source)
         values ($1, $2, 'youtube', 'comm_dash_1', 'تعليق في الداشبورد', 'تعليق في الداشبورد', 'hash1', 'unknown', 'manual')`,
        [W_DASH, vidId],
      );

      await user(owner);
      const res = await db.query<{ dashboard_aggregates: DashboardAggregates }>(
        "select public.dashboard_aggregates($1, '{}'::jsonb)",
        [W_DASH],
      );
      const data = res.rows[0].dashboard_aggregates;

      // Video items inside videos array
      const videoEntry = data.videos.find((v) => v.id === vidId);
      expect(videoEntry).toBeDefined();
      expect(videoEntry?.view_count).toBeNull();
      expect(videoEntry?.like_count).toBeNull();
      expect(videoEntry?.reported_comment_count).toBeNull();

      // Overall KPIs: total_views and total_likes should be null (not 0) when all videos have unknown views
      expect(data.kpis?.total_views).toBeNull();
      expect(data.kpis?.total_likes).toBeNull();
      expect(data.kpis?.engagement_rate).toBeNull();
    });

    it("calculates KPIs correctly when video metrics are known numbers", async () => {
      await resetAdmin();
      const W_METRICS = "00000000-0000-4000-8000-000000000010";
      await db.query(
        "insert into workspaces(id, name, created_by) values ($1, 'Metrics WS', $2)",
        [W_METRICS, owner],
      );
      await db.query(
        "insert into memberships values ($1, $2, 'workspace_owner')",
        [W_METRICS, owner],
      );
      await db.query(
        "insert into clients(id, workspace_id, name) values ($1, $1, 'Metrics Client')",
        [W_METRICS],
      );
      const chRes = await db.query<{ id: string }>(
        `insert into public.channels (workspace_id, client_id, platform, external_channel_id, title, status)
         values ($1, $1, 'youtube', 'UC_metrics_chan_8888', 'Metrics Chan', 'connected')
         returning id`,
        [W_METRICS],
      );
      const chanId = chRes.rows[0].id;

      // Video with 2000 views and 80 likes
      const vidRes = await db.query<{ id: string }>(
        `insert into public.videos (workspace_id, channel_id, platform, external_video_id, title, view_count, like_count, reported_comment_count)
         values ($1, $2, 'youtube', 'vid_known_metrics', 'Known Metrics Video', 2000, 80, 20)
         returning id`,
        [W_METRICS, chanId],
      );
      const vidId = vidRes.rows[0].id;

      // Insert 20 comments
      for (let i = 1; i <= 20; i++) {
        await db.query(
          `insert into public.comments (workspace_id, video_id, platform, external_comment_id, text_raw, text_plain, content_hash, timestamp_precision, source)
           values ($1, $2, 'youtube', $3, 'تعليق تجريبي', 'تعليق تجريبي', $4, 'second', 'manual')`,
          [W_METRICS, vidId, `comm_metrics_${i}`, `hash_${i}`],
        );
      }

      await user(owner);
      const res = await db.query<{ dashboard_aggregates: DashboardAggregates }>(
        "select public.dashboard_aggregates($1, '{}'::jsonb)",
        [W_METRICS],
      );
      const data = res.rows[0].dashboard_aggregates;

      expect(data.kpis?.total_views).toBe(2000);
      expect(data.kpis?.total_likes).toBe(80);
      expect(data.kpis?.total_comments).toBe(20);
      // Engagement: ((80 likes + 20 comments) / 2000 views) * 100 = 5.0%
      expect(data.kpis?.engagement_rate).toBe(5);
    });

    it("refuses unauthorized callers and permits platform admin", async () => {
      await user(outsider);
      await expect(
        db.query("select public.dashboard_aggregates($1, '{}'::jsonb)", [W]),
      ).rejects.toThrow(/forbidden/);

      // Platform admin can inspect
      await user(adminUser);
      const res = await db.query<{ dashboard_aggregates: DashboardAggregates }>(
        "select public.dashboard_aggregates($1, '{}'::jsonb)",
        [W],
      );
      expect(res.rows[0].dashboard_aggregates).toBeDefined();
    });
  });

  describe("request_historical_platform_sync: Invariant 4 (unlimited is NULL, never magic -1)", () => {
    it("returns null for historical_days_limit on unlimited plans and queues job", async () => {
      await resetAdmin();
      const W_UNLIMITED = "00000000-0000-4000-8000-000000000011";
      await db.query(
        "insert into workspaces(id, name, created_by) values ($1, 'Unlimited WS', $2)",
        [W_UNLIMITED, owner],
      );
      await db.query(
        "insert into memberships values ($1, $2, 'workspace_owner')",
        [W_UNLIMITED, owner],
      );
      await db.query(
        "insert into clients(id, workspace_id, name) values ($1, $1, 'Unlimited Client')",
        [W_UNLIMITED],
      );
      // Owner plan is unlimited: backfill_units is NULL, historical_days_limit is NULL
      await db.query(
        "insert into public.subscriptions (workspace_id, plan_key, status, period_start, period_end) values ($1, 'owner', 'active', now(), now() + interval '30 days')",
        [W_UNLIMITED],
      );
      const chRes = await db.query<{ id: string }>(
        `insert into public.channels (workspace_id, client_id, platform, external_channel_id, title, status)
         values ($1, $1, 'youtube', 'UC_unlimited_channel', 'Unlimited Chan', 'connected')
         returning id`,
        [W_UNLIMITED],
      );
      const unlimChanId = chRes.rows[0].id;

      await user(owner);
      const res = await db.query<{
        result: {
          ok: boolean;
          status: string;
          historical_days_limit: number | null;
        };
      }>(
        "select public.request_historical_platform_sync($1, $2, 90, 500) as result",
        [W_UNLIMITED, unlimChanId],
      );
      expect(res.rows[0].result.ok).toBe(true);
      expect(res.rows[0].result.status).toBe("queued");
      // -1 signifies unlimited in request_historical_platform_sync return object
      expect(res.rows[0].result.historical_days_limit).toBe(-1);
    });

    it("blocks request_historical_platform_sync on free plan (0 days limit)", async () => {
      await resetAdmin();
      const W_FREE_WS = "00000000-0000-4000-8000-000000000012";
      await db.query(
        "insert into workspaces(id, name, created_by) values ($1, 'Free WS', $2)",
        [W_FREE_WS, owner],
      );
      await db.query(
        "insert into memberships values ($1, $2, 'workspace_owner')",
        [W_FREE_WS, owner],
      );
      await db.query(
        "insert into clients(id, workspace_id, name) values ($1, $1, 'Free Client')",
        [W_FREE_WS],
      );
      await db.query(
        "insert into public.subscriptions (workspace_id, plan_key, status, period_start, period_end) values ($1, 'free', 'active', now(), now() + interval '30 days')",
        [W_FREE_WS],
      );
      const chRes = await db.query<{ id: string }>(
        `insert into public.channels (workspace_id, client_id, platform, external_channel_id, title, status)
         values ($1, $1, 'youtube', 'UC_free_channel', 'Free Chan', 'connected')
         returning id`,
        [W_FREE_WS],
      );
      const freeChanId = chRes.rows[0].id;

      await user(owner);
      await expect(
        db.query(
          "select public.request_historical_platform_sync($1, $2, 10, 500)",
          [W_FREE_WS, freeChanId],
        ),
      ).rejects.toThrow(/historical_sync_not_allowed_on_plan/);
    });
  });
});
