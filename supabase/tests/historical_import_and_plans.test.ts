import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const W_FREE = "00000000-0000-4000-8000-000000000002";
const W_OWNER = "00000000-0000-4000-8000-000000000003";
const owner = "10000000-0000-4000-8000-000000000001";
const adminUser = "10000000-0000-4000-8000-000000000002";
const viewer = "10000000-0000-4000-8000-000000000003";

let db: PGlite;
let channelId: string;
let freeChannelId: string;
let ownerChannelId: string;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const resetAdmin = () => db.exec("reset role");

describe("historical data import and dynamic plan limits", () => {
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

    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      owner,
      adminUser,
      viewer,
    ]);

    // Make adminUser a platform admin
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      adminUser,
    ]);

    // Workspaces
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Creator Workspace',$4),($2,'Free Workspace',$4),($3,'Owner Workspace',$4)",
      [W, W_FREE, W_OWNER, owner],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$2,'workspace_owner'),($4,$2,'workspace_owner'),($1,$5,'viewer')",
      [W, owner, W_FREE, W_OWNER, viewer],
    );

    // Subscriptions: W on creator (30 days, 40000 backfill), W_FREE on free (0 days, 0 backfill), W_OWNER on owner (unlimited)
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'creator','active',now(),now()+'30 days'::interval),($2,'free','active',now(),now()+'30 days'::interval),($3,'owner','active',now(),now()+'30 days'::interval)",
      [W, W_FREE, W_OWNER],
    );

    // Clients
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Client A'),($2,$2,'Client B'),($3,$3,'Client C')",
      [W, W_FREE, W_OWNER],
    );

    // Channels
    const c1 = await db.query<{ id: string }>(
      "insert into channels(workspace_id,client_id,platform,external_channel_id,title) values ($1,$1,'youtube','UC12345','Creator Channel') returning id",
      [W],
    );
    channelId = c1.rows[0].id;

    const c2 = await db.query<{ id: string }>(
      "insert into channels(workspace_id,client_id,platform,external_channel_id,title) values ($1,$1,'youtube','UCFREE','Free Channel') returning id",
      [W_FREE],
    );
    freeChannelId = c2.rows[0].id;

    const c3 = await db.query<{ id: string }>(
      "insert into channels(workspace_id,client_id,platform,external_channel_id,title) values ($1,$1,'youtube','UCOWNER','Owner Channel') returning id",
      [W_OWNER],
    );
    ownerChannelId = c3.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  describe("update_plan_limits admin RPC", () => {
    it("allows platform admins to dynamically update plan limits", async () => {
      await user(adminUser);
      const res = await db.query<{
        result: {
          ok: boolean;
          plan: { historical_days_limit: number; backfill_units: number };
        };
      }>(
        "select public.update_plan_limits('creator', jsonb_build_object('historical_days_limit', 45, 'backfill_units', 50000)) as result",
      );
      const parsed = res.rows[0].result;
      expect(parsed.ok).toBe(true);
      expect(parsed.plan.historical_days_limit).toBe(45);
      expect(parsed.plan.backfill_units).toBe(50000);

      // Verify plans table directly
      await resetAdmin();
      const planCheck = await db.query<{
        historical_days_limit: number;
        backfill_units: number;
      }>(
        "select historical_days_limit, backfill_units from public.plans where key = 'creator'",
      );
      expect(planCheck.rows[0].historical_days_limit).toBe(45);
      expect(planCheck.rows[0].backfill_units).toBe(50000);

      // Restore to 30 days and 40000
      await user(adminUser);
      await db.query(
        "select public.update_plan_limits('creator', jsonb_build_object('historical_days_limit', 30, 'backfill_units', 40000))",
      );
    });

    it("allows updating channels, topic units, members, workspaces, and setting unlimited (-1)", async () => {
      await user(adminUser);
      const res = await db.query<{
        result: {
          ok: boolean;
          plan: {
            limits: {
              channels: number;
              topic_units: number;
              members: number;
              workspaces: number;
              analysis_units: number;
            };
            backfill_units: number;
            historical_days_limit: number;
          };
        };
      }>(
        `select public.update_plan_limits('creator', jsonb_build_object(
          'channels', 5,
          'topic_units', 8000,
          'members', 4,
          'workspaces', 2,
          'historical_days_limit', -1,
          'backfill_units', -1
        )) as result`,
      );
      const parsed = res.rows[0].result;
      expect(parsed.ok).toBe(true);
      expect(parsed.plan.limits.channels).toBe(5);
      expect(parsed.plan.limits.topic_units).toBe(8000);
      expect(parsed.plan.limits.members).toBe(4);
      expect(parsed.plan.limits.workspaces).toBe(2);
      expect(parsed.plan.historical_days_limit).toBe(-1);
      expect(parsed.plan.backfill_units).toBe(-1);

      // Verify plans table directly shows NULL for unlimited columns
      await resetAdmin();
      const planCheck = await db.query<{
        channels_limit: number;
        topic_units: number;
        members_limit: number;
        workspaces_limit: number;
        historical_days_limit: number | null;
        backfill_units: number | null;
      }>(
        "select channels_limit, topic_units, members_limit, workspaces_limit, historical_days_limit, backfill_units from public.plans where key = 'creator'",
      );
      expect(planCheck.rows[0].channels_limit).toBe(5);
      expect(planCheck.rows[0].topic_units).toBe(8000);
      expect(planCheck.rows[0].members_limit).toBe(4);
      expect(planCheck.rows[0].workspaces_limit).toBe(2);
      expect(planCheck.rows[0].historical_days_limit).toBeNull();
      expect(planCheck.rows[0].backfill_units).toBe(2147483647);

      // Restore back to original creator limits
      await user(adminUser);
      await db.query(
        `select public.update_plan_limits('creator', jsonb_build_object(
          'channels', 1,
          'topic_units', 4000,
          'members', 1,
          'workspaces', 1,
          'historical_days_limit', 30,
          'backfill_units', 40000
        ))`,
      );
    });

    it("rejects non-admin users from updating plan limits", async () => {
      await user(owner);
      await expect(
        db.query(
          "select public.update_plan_limits('creator', jsonb_build_object('historical_days_limit', 60))",
        ),
      ).rejects.toThrow(/forbidden/);
    });
  });

  describe("request_historical_platform_sync", () => {
    it("rejects sync if plan historical_days_limit is 0 (Free tier)", async () => {
      await user(owner);
      await expect(
        db.query(
          "select public.request_historical_platform_sync($1, $2, now() - interval '10 days')",
          [W_FREE, freeChannelId],
        ),
      ).rejects.toThrow(/historical_sync_not_allowed_on_plan/);
    });

    it("rejects sync if requested since date is beyond plan limit", async () => {
      await user(owner);
      // Creator plan limit is 30 days; requesting 40 days ago should fail
      await expect(
        db.query(
          "select public.request_historical_platform_sync($1, $2, now() - interval '40 days')",
          [W, channelId],
        ),
      ).rejects.toThrow(/date_beyond_plan_limit/);
    });

    it("enqueues historical import job when within allowed plan limits", async () => {
      await user(owner);
      const res = await db.query<{
        result: {
          ok: boolean;
          status: string;
          historical_days_limit: number;
          job_id: string;
        };
      }>(
        "select public.request_historical_platform_sync($1, $2, now() - interval '20 days', 300) as result",
        [W, channelId],
      );
      const data = res.rows[0].result;
      expect(data.ok).toBe(true);
      expect(data.status).toBe("queued");
      expect(data.historical_days_limit).toBe(30);

      // Check job in public.jobs
      await resetAdmin();
      const job = await db.query<{
        type: string;
        checkpoint: { is_historical?: boolean };
      }>("select type, checkpoint from public.jobs where id = $1", [
        data.job_id,
      ]);
      expect(job.rows[0].type).toBe("import");
      expect(job.rows[0].checkpoint.is_historical).toBe(true);
    });

    it("allows unlimited sync on owner plan and supports named argument overload", async () => {
      await user(owner);
      const res = await db.query<{
        result: {
          ok: boolean;
          status: string;
          historical_days_limit: number | null;
          job_id: string;
        };
      }>(
        `select public.request_historical_platform_sync(
          w => $1,
          p_channel_id => $2,
          p_days_back => 365,
          p_max_items => 500,
          p_published_after => '2024-01-09T00:00:00Z'::timestamptz
        ) as result`,
        [W_OWNER, ownerChannelId],
      );
      const data = res.rows[0].result;
      expect(data.ok).toBe(true);
      expect(data.status).toBe("queued");
      expect(data.historical_days_limit).toBeNull(); // NULL signifies unlimited
    });
  });

  describe("import_historical_records (CSV / JSON)", () => {
    it("rejects external import if plan does not allow historical backfill", async () => {
      await user(owner);
      const payload = {
        posts: [{ external_video_id: "v1", title: "Free Test" }],
        comments: [
          {
            external_video_id: "v1",
            external_comment_id: "c1",
            text_raw: "تعليق تجريبي",
          },
        ],
      };
      await expect(
        db.query("select public.import_historical_records($1, $2, $3::jsonb)", [
          W_FREE,
          freeChannelId,
          JSON.stringify(payload),
        ]),
      ).rejects.toThrow(/historical_sync_not_allowed_on_plan/);
    });

    it("imports posts and comments and meters under historical_backfill", async () => {
      await user(owner);
      const payload = {
        posts: [
          {
            external_video_id: "vid_hist_1",
            title: "منشور تاريخي مميز",
            kind: "video",
          },
        ],
        comments: [
          {
            external_video_id: "vid_hist_1",
            external_comment_id: "comm_hist_1",
            author_name: "سارة",
            text_raw: "محتوى قيم ومفيد جداً شكراً لكم",
            published_at: new Date(
              Date.now() - 5 * 24 * 3600 * 1000,
            ).toISOString(),
          },
          {
            external_video_id: "vid_hist_1",
            external_comment_id: "comm_hist_2",
            author_name: "عمر",
            text_raw: "تحليل رائع ومقنع",
            published_at: new Date(
              Date.now() - 6 * 24 * 3600 * 1000,
            ).toISOString(),
          },
        ],
      };

      const res = await db.query<{
        result: {
          ok: boolean;
          posts_count: number;
          comments_count: number;
          backfill_units_used: number;
        };
      }>(
        "select public.import_historical_records($1, $2, $3::jsonb) as result",
        [W, channelId, JSON.stringify(payload)],
      );
      const result = res.rows[0].result;
      expect(result.ok).toBe(true);
      expect(result.posts_count).toBe(1);
      expect(result.comments_count).toBe(2);
      expect(result.backfill_units_used).toBe(2);

      // Verify usage_events metered under 'historical_backfill' and NOT 'comment_analysis'
      await resetAdmin();
      const events = await db.query<{ event_type: string; count: number }>(
        "select event_type, count(*)::int as count from public.usage_events where workspace_id = $1 group by event_type",
        [W],
      );
      const histEvent = events.rows.find(
        (e) => e.event_type === "historical_backfill",
      );
      expect(histEvent).toBeDefined();
      expect(histEvent?.count).toBe(2);

      const analysisEvent = events.rows.find(
        (e) => e.event_type === "comment_analysis",
      );
      expect(analysisEvent).toBeUndefined(); // Did NOT touch monthly comment_analysis!
    });

    it("allows external import on owner plan and supports named argument overload", async () => {
      await user(owner);
      const payload = {
        posts: [
          {
            external_video_id: "vid_owner_1",
            title: "منشور غير محدود",
            kind: "video",
          },
        ],
        comments: [
          {
            external_video_id: "vid_owner_1",
            external_comment_id: "comm_owner_1",
            author_name: "مستخدم الجزيرة",
            text_raw: "تعليق من عام 2024",
            published_at: "2024-01-09T12:00:00Z",
          },
        ],
      };

      const res = await db.query<{
        result: {
          ok: boolean;
          posts_count: number;
          comments_count: number;
        };
      }>(
        `select public.import_historical_records(
          w => $1,
          p_channel_id => $2,
          p_payload => $3::jsonb
        ) as result`,
        [W_OWNER, ownerChannelId, JSON.stringify(payload)],
      );
      const result = res.rows[0].result;
      expect(result.ok).toBe(true);
      expect(result.posts_count).toBe(1);
      expect(result.comments_count).toBe(1);
    });
  });
});
